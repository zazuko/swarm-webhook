/* eslint-disable @typescript-eslint/no-unused-vars */
import Docker from 'dockerode';
import fastify from 'fastify';

const server = fastify();
const docker = new Docker();

const WEBHOOK_ENABLED_LABEL = 'swarm.webhook.enabled';
const WEBHOOK_NAME_LABEL = 'swarm.webhook.name';
const WEBHOOK_REPLICAS_LABEL = 'swarm.webhook.replicas';
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
 * Get the desired number of replicas for a specific service.
 *
 * @param service Docker service.
 * @param fallback Default value for replicas.
 * @returns Number of desired replicas.
 */
const getDesiredReplicas = (
  service: Docker.Service,
  fallback: number | string = 1,
): number => {
  let replicas = parseInt(`${fallback}`, 10);

  if (!service.Spec?.Labels) {
    return replicas;
  }

  if (WEBHOOK_REPLICAS_LABEL in service.Spec.Labels) {
    replicas = parseInt(
      service.Spec.Labels[WEBHOOK_REPLICAS_LABEL] || `${fallback}`,
      10,
    );
  }

  return replicas;
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
): Docker.Service[] => {
  return services.filter((service) => {
    if (!service.Spec?.Labels) {
      return false;
    }

    if (WEBHOOK_NAME_LABEL in service.Spec.Labels) {
      return service.Spec.Labels[WEBHOOK_NAME_LABEL] === name;
    }

    return false;
  });
};

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
      targetServices.map((service) => {
        const replicas = getDesiredReplicas(service, 1);

        return docker.getService(service.ID).update({
          ...service.Spec,
          Mode: {
            ...service.Spec?.Mode,
            Replicated: {
              ...service.Spec?.Mode?.Replicated,
              Replicas: replicas,
            },
          },
          TaskTemplate: {
            ...service.Spec?.TaskTemplate,
            ForceUpdate: service.Version?.Index,
          },
          version: service.Version?.Index,
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
      targetServices.map((service) =>
        docker.getService(service.ID).update({
          ...service.Spec,
          Mode: {
            ...service.Spec?.Mode,
            Replicated: {
              ...service.Spec?.Mode?.Replicated,
              Replicas: 0,
            },
          },
          version: service.Version?.Index,
        }),
      ),
    );

    return update;
  });

  // webhook server listening of specified port
  server.listen({ port: parseInt(`${port}`, 10), host }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    logMessage(`Server listening at: ${address}`);
  });
})();
