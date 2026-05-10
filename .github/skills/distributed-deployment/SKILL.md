---
name: distributed-deployment
description: Deploying kaseki-agent across multiple hosts, regions, and cloud platforms
tags: [kaseki, kubernetes, deployment, ha, load-balancing, scaling, multi-host, multi-region]
relatedSkills: [disaster-recovery, environment-configuration, docker-image-management, workflow-diagnosis]
---

# Distributed Deployment for Kaseki Agent

This skill guides deploying kaseki-agent across multiple hosts, regions, and cloud platforms for high availability, scalability, and resilience.

## Overview

**When to Use**:
- Deploying kaseki to production with uptime SLA
- Scaling to handle 100+ concurrent runs
- Distributing across multiple data centers or regions
- Load-balancing API requests
- Setting up multi-region failover

**Key Concepts**:
- **Single-host baseline**: Simple local Docker or docker-compose
- **Multi-host cluster**: Load-balanced API with separated workers
- **Kubernetes**: Container orchestration with auto-scaling and rolling updates
- **Multi-region**: Geographic distribution with replication and failover

---

## Architecture Patterns

### Pattern 1: Single-Host (Baseline)

**Deployment**:
```bash
docker-compose up -d kaseki-api kaseki-worker
```

**Limitations**: Single point of failure, no scaling

### Pattern 2: Multi-Host with Load Balancer

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │   (Route 53)    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────▼────┐   ┌─────▼────┐  ┌────▼────┐
         │ Host A  │   │  Host B  │  │ Host C  │
         │ API x1  │   │  API x1  │  │ API x1  │
         │ Worker  │   │ Worker   │  │ Worker  │
         └─────────┘   └──────────┘  └─────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │  Shared Storage │
                    │  (EFS or NFS)   │
                    └─────────────────┘
```

**Configuration**:
```bash
# On each host
docker-compose -f docker-compose.distributed.yml up -d

# AWS Route53 health checks
aws route53 create-health-check \
  --ip-address 10.0.1.10 \
  --port 8080 \
  --type HTTP \
  --resource-path /health
```

### Pattern 3: Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kaseki-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: kaseki-api
  template:
    metadata:
      labels:
        app: kaseki-api
    spec:
      containers:
      - name: kaseki-api
        image: docker.io/cyanautomation/kaseki-agent:latest
        ports:
        - containerPort: 8080
        env:
        - name: KASEKI_API_KEYS
          valueFrom:
            secretKeyRef:
              name: kaseki-secrets
              key: api-keys
        volumeMounts:
        - name: results-storage
          mountPath: /agents/kaseki-results
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
      volumes:
      - name: results-storage
        persistentVolumeClaim:
          claimName: kaseki-results-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: kaseki-api-service
spec:
  type: LoadBalancer
  selector:
    app: kaseki-api
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8080
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: kaseki-api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: kaseki-api
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Pattern 4: Multi-Region with Replication

```
Region A (Primary)          Region B (Secondary)
    ┌──────────────┐           ┌──────────────┐
    │ Kaseki API   │           │ Kaseki API   │
    │ + S3 Bucket  │◄──────────►│ + S3 Bucket  │
    └──────────────┘           └──────────────┘
         │                           │
         └───────────┬───────────────┘
                     │
            S3 Cross-Region
            Replication
```

**Setup**:
```bash
# Primary region (us-east-1)
aws s3 mb s3://kaseki-results-primary

# Secondary region (us-west-2)
aws s3 mb s3://kaseki-results-secondary

# Enable replication
aws s3api put-bucket-replication \
  --bucket kaseki-results-primary \
  --replication-configuration \
  '[
    {
      "Status": "Enabled",
      "Priority": 1,
      "DeleteMarkerReplication": {"Status": "Enabled"},
      "Filter": {"Prefix": ""},
      "Destination": {
        "Bucket": "arn:aws:s3:::kaseki-results-secondary",
        "ReplicationTime": {
          "Status": "Enabled",
          "Time": {"Minutes": 15}
        }
      }
    }
  ]'
```

---

## Shared Storage Solutions

### Option 1: AWS EFS (Elastic File System)

```bash
# Create EFS
aws efs create-file-system \
  --performance-mode generalPurpose \
  --throughput-mode bursting

# Mount in docker-compose
volumes:
  kaseki-results:
    driver: nfs
    driver_opts:
      addr: fs-abc123.efs.us-east-1.amazonaws.com
      vers: 4.1
      o: "nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2"
```

### Option 2: NFS (Network File System)

```bash
# On NFS server
sudo apt-get install nfs-kernel-server
sudo mkdir -p /srv/kaseki-results
sudo echo "/srv/kaseki-results *(rw,sync,no_subtree_check)" >> /etc/exports
sudo exportfs -a

# On each host
docker-compose.yml:
volumes:
  kaseki-results:
    driver: nfs
    driver_opts:
      addr: nfs-server.example.com
      vers: 4
      o: rw
```

### Option 3: S3 (Simple Storage Service)

```bash
# All hosts sync to S3
aws s3 sync /agents/kaseki-results s3://kaseki-results-bucket/ \
  --delete \
  --sse AES256

# With periodic sync from cron
0 */6 * * * aws s3 sync /agents/kaseki-results s3://kaseki-results-bucket/ --delete
```

---

## Health Checks & Load Balancing

### Kubernetes Probes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
```

### AWS Target Group Health Check

```bash
aws elbv2 create-target-group \
  --name kaseki-api-tg \
  --protocol HTTP \
  --port 8080 \
  --vpc-id vpc-abc123 \
  --health-check-protocol HTTP \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 2
```

---

## Cross-Host Monitoring

### Distributed Logging with ELK

```yaml
# In docker-compose.yml
services:
  kaseki-api:
    logging:
      driver: awslogs
      options:
        awslogs-group: /kaseki/api
        awslogs-region: us-east-1
        awslogs-stream-prefix: ${HOSTNAME}

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.0.0
    environment:
      discovery.type: single-node

  kibana:
    image: docker.elastic.co/kibana/kibana:8.0.0
    ports:
      - "5601:5601"
    environment:
      ELASTICSEARCH_HOSTS: http://elasticsearch:9200
```

### Metrics Aggregation with Prometheus

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'kaseki-api'
    static_configs:
      - targets: ['kaseki-api-1:8080', 'kaseki-api-2:8080', 'kaseki-api-3:8080']
    metrics_path: '/metrics'
```

---

## Troubleshooting Distributed Deployments

### Issue: API Instances Out of Sync

**Symptom**: Different /agents/ directories on different hosts

**Solution**: Use shared storage (EFS/NFS) or sync mechanism

```bash
# Validate shared storage mount
mount | grep kaseki-results
# Should show mount point

# Check file consistency across hosts
for host in api-1 api-2 api-3; do
  echo "=== $host ==="
  ssh $host "ls -la /agents/kaseki-results/ | wc -l"
done
```

### Issue: Stale Cache in Multi-Host Setup

**Symptom**: Some hosts have old node_modules, others have new

**Solution**: Invalidate cache across all hosts

```bash
# Clear workspace cache on all hosts
for host in api-1 api-2 api-3; do
  ssh $host "rm -rf /agents/kaseki-cache"
done

# Rebuild Docker image if seed cache is stale
docker build --no-cache -t kaseki-template:latest .
# Restart all containers
docker-compose down && docker-compose up -d
```

### Issue: Load Balancer Sends Requests to Unhealthy Pod

**Solution**: Ensure health checks pass on all instances

```bash
# Test health endpoint on each host
for host in api-1 api-2 api-3; do
  echo "=== $host ==="
  curl -s http://$host:8080/health | jq .
done
```

---

## See Also

- [DISTRIBUTED_SETUP.md](../../docs/DISTRIBUTED_SETUP.md) — Comprehensive distributed deployment guide
- [disaster-recovery](disaster-recovery.md) — Failover and incident response
- [DEPLOYMENT.md](../../docs/DEPLOYMENT.md) — Basic deployment and API service setup
- [environment-configuration](environment-configuration.md) — Multi-host configuration
