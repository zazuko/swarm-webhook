# Swarm webhook

## Quick start

Create a `docker-compose.yaml` file with the following content:

```yaml
version: "3"

services:
  webhook:
    image: ghcr.io/zazuko/swarm-webhook
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock"
    ports:
      - 3000:3000
    environment:
      - SERVER_HOST=0.0.0.0
      - SERVER_PORT=3000
    deploy:
      placement:
        constraints:
          - node.role == manager

  nginx:
    image: nginx:1.21-alpine
    deploy:
      mode: replicated
      replicas: 0
      labels:
        - swarm.webhook.enabled=true
        - swarm.webhook.name=nginx
      restart_policy:
        condition: none

  nginx-two:
    image: nginx:1.21-alpine
    deploy:
      mode: replicated
      replicas: 0
      labels:
        - swarm.webhook.enabled=true
        - swarm.webhook.name=nginx-two
      restart_policy:
        condition: none
```

Make sure you have a Swarm cluster (`docker swarm init`), and run the stack using:

```sh
docker stack deploy -c docker-compose.yaml swarm-webhook
```

Some actions:

- http://127.0.0.1:3000/ : list all containers with webhook enabled
- http://127.0.0.1:3000/start/nginx : start the container for the `nginx` service
- http://127.0.0.1:3000/stop/nginx : stop the container for the `nginx` service
- http://127.0.0.1:3000/start/nginx-two : start the container for the `nginx-two` service
- http://127.0.0.1:3000/stop/nginx-two : stop the container for the `nginx-two` service

You can use `docker ps` to see the containers that are running.

To remove the stack, use:

```sh
docker stack rm swarm-webhook
```

## Use it in your stack

### Deploying the webhook service

You have to deploy the webhook service:

```yaml
webhook:
  image: ghcr.io/zazuko/swarm-webhook
  volumes:
    - "/var/run/docker.sock:/var/run/docker.sock"
  ports:
    - 3000:3000
  environment:
    - SERVER_HOST=0.0.0.0
    - SERVER_PORT=3000
  deploy:
    placement:
      constraints:
        - node.role == manager
```

You can use following environment variables:

- `SERVER_PORT`: configure the server port (default: `3000`)
- `SERVER_HOST`: configure the server host (default: `::`)

### Configure your services

You will have to edit the `deploy` part of your services to have something like the following:

```yaml
your-service:
  # …
  deploy:
    mode: replicated
    replicas: 0
    labels:
      - swarm.webhook.enabled=true
      - swarm.webhook.name=your-service
    restart_policy:
      condition: none
```

The `swarm.webhook.enabled=true` is useful to filter only on services having this label.

You will also have to add the `swarm.webhook.name=your-service` label (by changing `your-service` with something which is unique).
This will be the part you should provide in the URL: `WEBHOOK_URL/start/your-service`.
