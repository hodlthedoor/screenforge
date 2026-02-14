# Docker Hub Publishing

ScreenForge Docker images are published to both [GitHub Container Registry](https://ghcr.io/hodlthedoor/screenforge) and [Docker Hub](https://hub.docker.com/r/hodlthedoor/screenforge) on every tagged release.

Images are built for **linux/amd64** and **linux/arm64**.

## Pull from Docker Hub

```bash
docker pull hodlthedoor/screenforge:latest
docker pull hodlthedoor/screenforge:1.0.0  # specific version
```

## GitHub Secrets Setup

The release workflow requires two GitHub repository secrets for Docker Hub publishing:

| Secret | Description |
|--------|-------------|
| `DOCKER_USERNAME` | Your Docker Hub username |
| `DOCKER_TOKEN` | A Docker Hub access token |

### Creating a Docker Hub Access Token

1. Log in to [hub.docker.com](https://hub.docker.com)
2. Go to **Account Settings** → **Security** → **Access Tokens**
3. Click **New Access Token**
4. Name it (e.g., `screenforge-github-actions`) and select **Read & Write** permissions
5. Copy the token — it's only shown once

### Adding Secrets to GitHub

1. Go to the repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add:
   - `DOCKER_USERNAME` = your Docker Hub username
   - `DOCKER_TOKEN` = the access token from above

If these secrets are not configured, the Docker Hub login step will be skipped and images will only be pushed to ghcr.io. The workflow detects the login outcome and conditionally includes Docker Hub tags only when authentication succeeds.

## Manual Build & Push (Fallback)

If CI is unavailable, you can build and push manually:

```bash
# Login to Docker Hub
docker login

# Build multi-arch image
docker buildx create --use --name screenforge-builder 2>/dev/null || true
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t hodlthedoor/screenforge:latest \
  -t hodlthedoor/screenforge:$(node -p "require('./package.json').version") \
  --push .

# Clean up builder (optional)
docker buildx rm screenforge-builder
```

## Using Docker Hub Images with Docker Compose

In `docker-compose.yml`, replace the `build` directive with the `image` directive:

```yaml
services:
  screenforge:
    # build: .
    image: hodlthedoor/screenforge:latest
```
