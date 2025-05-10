# Configuration Files

This directory contains environment-specific configuration files that are used by the Docker Compose setup.

## Security Notice

These files contain sensitive information and should NEVER be committed to source control.
The `.gitignore` file has been configured to exclude `*.env` files in this directory.

## Environment Files

- `postgres.env`: Database credentials
- `pgadmin.env`: PgAdmin login credentials
- `server.env`: Server-specific environment variables

## For Production

Consider using:
1. Docker Swarm secrets
2. Kubernetes secrets
3. Environment variable injection from a secure vault service
4. CI/CD pipelines that inject secrets during deployment

## Setup

Copy the example files and modify them with your secure credentials:

```bash
cp postgres.env.example postgres.env
cp pgadmin.env.example pgadmin.env  
cp server.env.example server.env
```

Then edit each file with secure, unique passwords. 