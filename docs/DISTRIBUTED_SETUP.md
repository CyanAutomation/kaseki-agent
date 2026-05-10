# Distributed & Multi-Host Setup Guide

This guide covers deploying kaseki-agent across multiple hosts, regions, or cloud providers for high availability and scale.

---

## Architecture Overview

### Single-Host Baseline

```
┌─────────────────────────────────────────┐
│  Single Host                            │
│  ├─ Docker Compose (API service)        │
│  ├─ /agents/kaseki-results/             │
│  ├─ /agents/kaseki-runs/                │
│  └─ /agents/kaseki-cache/               │
└─────────────────────────────────────────┘
```

### Multi-Host with Load Balancer

```
                    ┌────────────────┐
                    │  Load Balancer │
                    │ (nginx/HAProxy)│
                    └────────┬───────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │ Host 1  │          │ Host 2  │          │ Host 3  │
   │ API: 1  │          │ API: 1  │          │ API: 1  │
   │/agents/ │          │/agents/ │          │/agents/ │
   └─────────┘          └─────────┘          └─────────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                   ┌─────────▼──────────┐
                   │ Shared NFS/S3      │
                   │ /agents/results/   │
                   └────────────────────┘
```

---

## Scenario 1: Simple Multi-Host (Regional)

Deploy API service across multiple regions for lower latency and fault tolerance.

### Setup

**Host A (US-East):**

```bash
# Set up API service
cd /agents/kaseki-template
docker-compose up -d

# Mount shared results directory
# Option A: NFS
sudo mount -t nfs nfs-server:/kaseki-results /agents/kaseki-results

# Option B: AWS EFS
sudo mount -t efs fs-12345678:/ /agents/kaseki-results
```

**Host B (US-West):**

```bash
# Same setup, mount same shared directory
cd /agents/kaseki-template
docker-compose up -d

# Mount shared results
sudo mount -t nfs nfs-server:/kaseki-results /agents/kaseki-results
```

**Load Balancer (nginx):**

```nginx
upstream kaseki_api {
  server host-a.example.com:8080;
  server host-b.example.com:8080;
  # Add more hosts as needed
}

server {
  listen 80;
  server_name api.kaseki.example.com;
  
  location / {
    proxy_pass http://kaseki_api;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Forwarded-For $remote_addr;
    
    # Session persistence (if needed)
    # proxy_cookie_path / /;
  }
}
```

### Benefits

- **Redundancy**: If one host fails, others handle requests
- **Lower latency**: Route to nearest region
- **Shared state**: All hosts see same results, no sync needed
- **Simple scaling**: Add more hosts behind load balancer

---

## Scenario 2: Separated API & Workers

Decouple API service from worker containers for independent scaling.

### Architecture

```
        ┌──────────────────────┐
        │  API Service Tier    │
        │  (3x replicas)       │
        │  No Docker socket    │
        └──────────┬───────────┘
                   │ (REST API)
        ┌──────────▼───────────┐
        │ Job Queue (Redis)    │
        │ (distributed queue)  │
        └──────────┬───────────┘
                   │
  ┌────────────────┼────────────────┐
  │                │                │
  ▼                ▼                ▼
┌────────┐    ┌────────┐       ┌────────┐
│Worker1 │    │Worker2 │ ...   │WorkerN │
│Docker  │    │Docker  │       │Docker  │
└────────┘    └────────┘       └────────┘
  (scale independently)
```

### Setup

**Deploy API Service (no Docker socket required):**

```yaml
# docker-compose.yml
services:
  kaseki-api:
    image: kaseki-agent:node24-local
    ports:
      - "8080:8080"
    environment:
      KASEKI_API_KEYS: $KASEKI_API_KEYS
      KASEKI_REDIS_URL: redis://redis.example.com:6379
      # No Docker socket needed!
    volumes:
      - /agents/kaseki-results:/agents/kaseki-results:rw
```

**Deploy Workers (Docker access required):**

```yaml
services:
  kaseki-worker:
    image: kaseki-agent:node24-local
    environment:
      KASEKI_REDIS_URL: redis://redis.example.com:6379
      KASEKI_RESULTS_DIR: /agents/kaseki-results
    volumes:
      - /agents:/agents:rw
      - /var/run/docker.sock:/var/run/docker.sock
    command: npm run kaseki-worker  # Not yet implemented; shows pattern
    deploy:
      replicas: 5  # Scale as needed
```

**Deploy Redis (queue backend):**

```bash
docker run -d \
  --name kaseki-redis \
  -p 6379:6379 \
  redis:7-alpine
```

### Benefits

- **Independent scaling**: Add workers without API instances
- **Cost optimization**: Run API on cheap nodes, workers on compute-optimized
- **Fault isolation**: API failure doesn't affect workers
- **Better resource utilization**: Each tier gets right resources

### Current Status

*Note: Distributed queue support is a future enhancement. Currently, API submits runs directly to Docker on same host.*

---

## Scenario 3: Kubernetes Deployment

Deploy kaseki-agent as Kubernetes services for cloud-native orchestration.

### Namespace & RBAC

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: kaseki

---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kaseki-api
  namespace: kaseki

---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: kaseki-api
  namespace: kaseki
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["create", "get", "list", "watch", "delete"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

### Deployment: API Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kaseki-api
  namespace: kaseki
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
      serviceAccountName: kaseki-api
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
        - name: OPENROUTER_API_KEY
          valueFrom:
            secretKeyRef:
              name: kaseki-secrets
              key: openrouter-key
        - name: KASEKI_API_PORT
          value: "8080"
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2
            memory: 2Gi
        volumeMounts:
        - name: results
          mountPath: /agents/kaseki-results
      volumes:
      - name: results
        persistentVolumeClaim:
          claimName: kaseki-results-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: kaseki-api
  namespace: kaseki
spec:
  selector:
    app: kaseki-api
  ports:
  - port: 8080
    targetPort: 8080
  type: LoadBalancer
```

### Persistent Volume (Results Storage)

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: kaseki-results-pvc
  namespace: kaseki
spec:
  accessModes:
    - ReadWriteMany  # Required for multi-pod access
  storageClassName: efs  # AWS EFS or equivalent
  resources:
    requests:
      storage: 500Gi
```

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: kaseki-api-hpa
  namespace: kaseki
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: kaseki-api
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Deploy

```bash
# Create namespace
kubectl create namespace kaseki

# Add secrets
kubectl create secret generic kaseki-secrets \
  --from-literal=api-keys="sk-your-key" \
  --from-literal=openrouter-key="sk-or-your-key" \
  -n kaseki

# Deploy
kubectl apply -f kaseki-api-deployment.yaml

# Verify
kubectl get pods -n kaseki
kubectl get svc -n kaseki
```

### Access API

```bash
# Get LoadBalancer IP
kubectl get svc kaseki-api -n kaseki

# Test
curl http://<LOAD_BALANCER_IP>:8080/health
```

---

## Scenario 4: Multi-Region with Replication

Deploy across regions with replication for disaster recovery.

### Architecture

```
Region 1 (Primary)          Region 2 (Standby)
┌──────────────────┐        ┌──────────────────┐
│ API Service      │        │ API Service      │
│ (active)         │        │ (standby)        │
└────────┬─────────┘        └────────┬─────────┘
         │                           │
         └─────────┬─────────────────┘
                   │
          ┌────────▼────────┐
          │ S3 + Replication│
          │ (async sync)    │
          └─────────────────┘
```

### S3 Replication Setup

```bash
# Create primary bucket (region 1)
aws s3api create-bucket \
  --bucket kaseki-results-us-east-1 \
  --region us-east-1

# Create secondary bucket (region 2)
aws s3api create-bucket \
  --bucket kaseki-results-us-west-2 \
  --region us-west-2

# Enable versioning (required for replication)
aws s3api put-bucket-versioning \
  --bucket kaseki-results-us-east-1 \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-versioning \
  --bucket kaseki-results-us-west-2 \
  --versioning-configuration Status=Enabled

# Set up replication rule
aws s3api put-bucket-replication \
  --bucket kaseki-results-us-east-1 \
  --replication-configuration file://replication.json
```

**replication.json:**

```json
{
  "Role": "arn:aws:iam::ACCOUNT_ID:role/s3-replication-role",
  "Rules": [{
    "Status": "Enabled",
    "Priority": 1,
    "DeleteMarkerReplication": { "Status": "Enabled" },
    "Filter": { "Prefix": "" },
    "Destination": {
      "Bucket": "arn:aws:s3:::kaseki-results-us-west-2",
      "ReplicationTime": {
        "Status": "Enabled",
        "Time": { "Minutes": 15 }
      }
    }
  }]
}
```

### Failover Setup (DNS-based)

```yaml
# Route53 health check (AWS)
HealthCheck:
  HealthCheckConfig:
    Type: HTTPS
    ResourcePath: /health
    IPAddress: api.region1.example.com
    Port: 443
    RequestInterval: 30
    FailureThreshold: 3

# Failover routing policy
Record:
  Name: api.kaseki.example.com
  Type: A
  SetIdentifier: Primary
  Failover: PRIMARY
  AliasTarget:
    HostedZoneId: Z123
    DNSName: api.region1.example.com
    EvaluateTargetHealth: true

---
Record:
  Name: api.kaseki.example.com
  Type: A
  SetIdentifier: Secondary
  Failover: SECONDARY
  AliasTarget:
    HostedZoneId: Z456
    DNSName: api.region2.example.com
```

---

## Shared Storage Options

### NFS (Network File System)

**Pros:**

- POSIX-compliant (works like local filesystem)
- Simple setup
- Cost-effective

**Cons:**

- Potential latency (especially across regions)
- Single point of failure (unless clustered)

**Setup:**

```bash
# On NFS server
sudo exportfs -a -r

# On hosts
sudo mount -t nfs nfs-server:/kaseki-results /agents/kaseki-results
```

### AWS EFS (Elastic File System)

**Pros:**

- Fully managed
- Cross-AZ redundancy
- Good performance

**Cons:**

- AWS-specific
- Higher cost than NFS

**Setup:**

```bash
sudo mount -t efs fs-12345678:/ /agents/kaseki-results
```

### AWS S3 (with FUSE mount)

**Pros:**

- Unlimited storage
- Very durable
- Global access

**Cons:**

- Higher latency
- Eventually consistent
- Requires polling for updates

**Setup:**

```bash
# Install s3fs
sudo apt install s3fs

# Mount S3 bucket
s3fs my-kaseki-bucket /agents/kaseki-results \
  -o allow_other \
  -o use_cache=/tmp
```

---

## Monitoring Distributed Deployments

### Health Checks Across Hosts

```bash
#!/bin/bash
# health-check-all-hosts.sh

HOSTS=(
  "host-a.example.com"
  "host-b.example.com"
  "host-c.example.com"
)

for HOST in "${HOSTS[@]}"; do
  STATUS=$(curl -s http://$HOST:8080/health | jq -r '.status')
  echo "$HOST: $STATUS"
done
```

### Cross-Host Metrics

```bash
# Aggregate queue status across hosts
for HOST in host-a host-b host-c; do
  echo "=== $HOST ==="
  curl -s http://$HOST:8080/health | jq '.queue'
done

# Expected: queue state should be consistent across replicas
```

---

## Troubleshooting Distributed Deployments

### Shared Storage Not Mounted

```bash
# Verify mount on all hosts
df -h | grep kaseki-results

# If missing, remount
sudo mount /agents/kaseki-results
```

### Load Balancer Not Distributing Evenly

```bash
# Check backend status
curl http://load-balancer:8080/health -v

# Verify all backends are healthy
# If one is down, remove from rotation
```

### Results Inconsistent Across Hosts

```bash
# Verify shared storage is synced
stat /agents/kaseki-results/kaseki-N/metadata.json  # On multiple hosts
# All should show same mtime

# If not synced:
# - Check NFS/EFS status
# - Verify permissions
# - Restart API services
```

---

## See Also

- [DEPLOYMENT.md](DEPLOYMENT.md) — Single-host setup
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Common issues
- [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) — Failover procedures
