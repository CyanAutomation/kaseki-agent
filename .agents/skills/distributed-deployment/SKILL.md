---
name: distributed-deployment
description: Assess multi-host Kaseki deployments against the documented service and worker boundaries.
tags: [kaseki, deployment, docker, scaling, multi-host, multi-region]
relatedSkills: [environment-configuration, docker-image-management, workflow-diagnosis]
---

# Distributed Deployment for Kaseki Agent

Use this skill when planning to run Kaseki across hosts, regions, or worker
pools. The standard deployment guide describes the supported Pi and Docker
Compose setup; multi-host designs are custom deployments and need their own
failure, storage, and security review.

## Before proposing a topology

1. Read the active [deployment guide](../../../docs/DEPLOYMENT.md) and
   [distributed setup guide](../../../docs/DISTRIBUTED_SETUP.md).
2. Identify which process owns API state, job scheduling, worker containers,
   result files, secrets, and dependency caches. Do not assume the service is
   stateless or that local files are shared between hosts.
3. Define how workers reach the correct Docker daemon, repository checkout,
   secret mounts, and result storage. Treat Docker socket access as
   host-administrator access.
4. Specify health checks, queue behavior, duplicate submission handling,
   timeouts, retry policy, backup, and recovery before scaling concurrency.
5. Test the design with the actual image and storage backend under host loss,
   worker restart, and partial network failure.

## Deployment guidance

- Prefer the documented single-host deployment unless measured capacity or
  availability needs justify added coordination.
- Do not claim high availability from a load balancer alone. API state,
  idempotency, result files, mounted secrets, and worker scheduling must also
  behave consistently across instances.
- Keep cache storage separate from results and secrets. Configure retention
  through supported settings in the [environment reference](../../../docs/ENV_VARS.md).
- Use immutable image tags or digests and follow
  [Docker Image Management](../docker-image-management/SKILL.md) for image
  verification.

For API and deployment options, use the canonical guides above. The examples in
older architecture notes may describe patterns that are not supported by the
current release; verify every component against the implementation before use.
