/* eslint-disable @typescript-eslint/no-unused-vars */
import Docker from 'dockerode';
import fastify from 'fastify';

const server = fastify();
const docker = new Docker();

const WEBHOOK_ENABLED_LABEL = 'swarm.webhook.enabled';
const WEBHOOK_NAME_LABEL = 'swarm.webhook.name';
const port = process.env.SERVER_PORT || 3000;
const host = process.env.SERVER_HOST || '::';

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
 * Get the list of enabled services.
 * An enabled service is a service having the `WEBHOOK_ENABLED_LABEL` label set to `"true"`.
 */
const getEnabledServices = async (): Promise<Docker.Service[]> => {
  const allServices = await docker.listServices();

  return allServices.filter((service) => {
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
 * @param services list of Docker services to filer on.
 * @param name value of the `WEBHOOK_NAME_LABEL` label to filter on.
 * @returns a list of services having the label matching the name parameter.
 */
const filterServicesByName = (
  services: Docker.Service[],
  name: string,
): Docker.Service[] => services.filter((service) => {
  if (!service.Spec?.Labels) {
    return false;
  }

  if (WEBHOOK_NAME_LABEL in service.Spec.Labels) {
    return service.Spec.Labels[WEBHOOK_NAME_LABEL] === name;
  }

  return false;
});

(async () => {
  // list all containers having the `WEBHOOK_ENABLED_LABEL` label set to `true`
  server.get('/', async (_request, _reply) => {
    logMessage('list enabled services');

    const services = await getEnabledServices();

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
    const services = await getEnabledServices();
    const targetServices = filterServicesByName(services, targetService);

    const update = await Promise.all(
      targetServices.map(async (service) => {
        const dockerService = docker.getService(service.ID);
        let version = service.Version?.Index;
        const replicas = service.Spec?.Mode?.Replicated?.Replicas || 0;

        if (replicas > 0) {
          await dockerService.update({
            ...service.Spec,
            Mode: {
              ...service.Spec?.Mode,
              Replicated: {
                ...service.Spec?.Mode?.Replicated,
                Replicas: 0,
              },
            },
            TaskTemplate: {
              ...service.Spec?.TaskTemplate,
              ForceUpdate: version,
            },
            version,
          });

          const updatedDockerService = docker.getService(service.ID);
          const inspected = await updatedDockerService.inspect();
          if (inspected?.Version?.Index) {
            version = inspected?.Version?.Index;
          }
        }

        return dockerService.update({
          ...service.Spec,
          Mode: {
            ...service.Spec?.Mode,
            Replicated: {
              ...service.Spec?.Mode?.Replicated,
              Replicas: 1,
            },
          },
          TaskTemplate: {
            ...service.Spec?.TaskTemplate,
            ForceUpdate: version,
          },
          version,
        });
      }),
    );

    return update;
  });

  // stop a container
  server.get<{
    Params: Record<string, string>;
  }>('/stop/:service', async (request, _reply) => {
    const targetService = `${request.params.service}`;
    logMessage(`stop '${targetService}'`);
    const services = await getEnabledServices();
    const targetServices = filterServicesByName(services, targetService);

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
