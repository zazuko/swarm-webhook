/* eslint-disable @typescript-eslint/no-unused-vars */
import Docker from 'dockerode';
import fastify from 'fastify';

const server = fastify();
const docker = new Docker();

const WEBHOOK_ENABLED_LABEL = 'swarm.webhook.enabled';
const WEBHOOK_NAME_LABEL = 'swarm.webhook.name';
const port = process.env.SERVER_PORT || 3000;
const refreshInterval = +(process.env.REFRESH_INTERVAL || 2_000);
const restartDelay = +(process.env.RESTART_DELAY || 8_000);

let services: Docker.Service[] = [];

/**
 * Wait a number of milliseconds.
 *
 * @param ms number of milliseconds to wait.
 * @returns a promise that resolves after `ms` milliseconds.
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  server.get('/', async (_request, _reply) => services.map((service) => ({
    name: service.Spec?.Name,
    labels: service.Spec?.Labels,
    createdAt: service.CreatedAt,
    updatedAt: service.UpdatedAt,
  })));

  // start a container
  server.get<{
    Params: Record<string, string>;
  }>('/start/:service', async (request, _reply) => {
    const targetService = filterServicesByName(`${request.params.service}`);

    const update = await Promise.all(
      targetService.map((service) => docker.getService(service.ID).update({
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

  // force the restart of a container
  server.get<{
    Params: Record<string, string>;
  }>('/restart/:service', async (request, _reply) => {
    let targetService = filterServicesByName(`${request.params.service}`);

    await Promise.all(
      targetService.map((service) => docker.getService(service.ID).update({
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

    await delay(restartDelay);

    targetService = filterServicesByName(`${request.params.service}`);
    const update = await Promise.all(
      targetService.map((service) => docker.getService(service.ID).update({
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
    const targetService = filterServicesByName(`${request.params.service}`);

    const update = await Promise.all(
      targetService.map((service) => docker.getService(service.ID).update({
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
  server.listen(port, '::', (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at: ${address}`);
  });
})();
