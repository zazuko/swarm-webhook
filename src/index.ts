/* eslint-disable @typescript-eslint/no-unused-vars */
import Docker from 'dockerode';
import fastify from 'fastify';

const server = fastify();
const docker = new Docker();

const WEBHOOK_ENABLED_LABEL = 'swarm.webhook.enabled';
const WEBHOOK_NAME_LABEL = 'swarm.webhook.name';
const port = process.env.SERVER_PORT || 3000;
const host = process.env.SERVER_HOST || '::';
const refreshInterval = +(process.env.REFRESH_INTERVAL || 1_000);

let services: Docker.Service[] = [];

/**
 * Log a message.
 *
 * @param message Message to log.
 */
const logMessage = (message: string) => {
  const date = new Date();
  console.log(`[${date}] - ${message}`);
};

/**
 * Update the list of enabled services.
 * An enabled service is a service having the `WEBHOOK_ENABLED_LABEL` label set to `"true"`.
 */
const updateEnabledServices = async (): Promise<void> => {
  const allServices = await docker.listServices();

  services = allServices.filter((service) => {
    if (!service.Spec?.Labels) {
      return false;
    }

    if (WEBHOOK_ENABLED_LABEL in service.Spec.Labels) {
      return service.Spec.Labels[WEBHOOK_ENABLED_LABEL] === 'true';
    }

    return false;
  });
};

/**
 * Get the list of enabled services having a specific name.
 *
 * @param name value of the `WEBHOOK_NAME_LABEL` label to filter on.
 * @returns a list of services having the label matching the name parameter.
 */
const filterServicesByName = (name: string): Docker.Service[] => services.filter((service) => {
  if (!service.Spec?.Labels) {
    return false;
  }

  if (WEBHOOK_NAME_LABEL in service.Spec.Labels) {
    return service.Spec.Labels[WEBHOOK_NAME_LABEL] === name;
  }

  return false;
});

/**
 * Enable auto-updating the list of enabled services.
 *
 * @returns the interval identifier.
 */
const autoUpdateServicesList = async (): Promise<NodeJS.Timeout> => {
  await updateEnabledServices();

  return setInterval(async () => {
    await updateEnabledServices();
  }, refreshInterval);
};

(async () => {
  await autoUpdateServicesList();

  // list all containers having the `WEBHOOK_ENABLED_LABEL` label set to `true`
  server.get('/', async (_request, _reply) => {
    logMessage('list enabled services');

    return services.map((service) => ({
      name: service.Spec?.Name,
      labels: service.Spec?.Labels,
      createdAt: service.CreatedAt,
      updatedAt: service.UpdatedAt,
    }));
  });

  // start a container
  server.get<{
    Params: Record<string, string>;
  }>('/start/:service', async (request, _reply) => {
    const targetService = `${request.params.service}`;
    logMessage(`start '${targetService}'`);
    const targetServices = filterServicesByName(targetService);

    const update = await Promise.all(
      targetServices.map((service) => docker.getService(service.ID).update({
        ...service.Spec,
        Mode: {
          ...service.Spec?.Mode,
          Replicated: {
            ...service.Spec?.Mode?.Replicated,
            Replicas: 1,
          },
        },
        version: service.Version?.Index,
      })),
    );

    return update;
  });

  // stop a container
  server.get<{
    Params: Record<string, string>;
  }>('/stop/:service', async (request, _reply) => {
    const targetService = `${request.params.service}`;
    logMessage(`stop '${targetService}'`);
    const targetServices = filterServicesByName(targetService);

    const update = await Promise.all(
      targetServices.map((service) => docker.getService(service.ID).update({
        ...service.Spec,
        Mode: {
          ...service.Spec?.Mode,
          Replicated: {
            ...service.Spec?.Mode?.Replicated,
            Replicas: 0,
          },
        },
        version: service.Version?.Index,
      })),
    );

    return update;
  });

  // webhook server listening of specified port
  server.listen(port, host, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    logMessage(`Server listening at: ${address}`);
  });
})();
