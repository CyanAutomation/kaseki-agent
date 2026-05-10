---
name: disaster-recovery
description: Backup, recovery, and incident response for kaseki-agent production deployments
tags: [kaseki, backup, restore, disaster-recovery, incident-response, failover, data-loss, outage]
relatedSkills: [distributed-deployment, workflow-diagnosis, environment-configuration]
---

# Disaster Recovery for Kaseki Agent

This skill guides backup, recovery, and incident response procedures for kaseki-agent production deployments to ensure business continuity.

## Overview

**When to Use**:
- Planning backup and recovery strategy
- Recovering from data loss or corruption
- Responding to outages or service failures
- Setting up failover procedures
- Conducting disaster recovery drills

**Key Concepts**:
- **Backup Strategy**: Regular snapshots of /agents/kaseki-results
- **Recovery Procedures**: Steps to restore from backups
- **Incident Playbooks**: Step-by-step response for specific failures
- **Post-Incident Review**: Learning from failures

---

## Pre-Incident Preparation

### Backup Strategy

**Full Backup (Daily)**:
```bash
#!/bin/bash
# backup-kaseki.sh - runs daily via cron

BACKUP_DATE=$(date +%Y-%m-%d)
BACKUP_DIR="/backups/kaseki/$BACKUP_DATE"

mkdir -p "$BACKUP_DIR"

# Backup all results
tar -czf "$BACKUP_DIR/kaseki-results.tar.gz" /agents/kaseki-results/

# Backup configuration
tar -czf "$BACKUP_DIR/kaseki-config.tar.gz" \
  /etc/docker/compose/ \
  ~/.docker/config.json \
  ~/kaseki-env.sh

# Backup Docker images
docker save kaseki-template:latest | gzip > "$BACKUP_DIR/kaseki-image.tar.gz"

# Cleanup old backups (keep 30 days)
find /backups/kaseki -type d -mtime +30 -exec rm -rf {} \;

echo "Backup complete: $BACKUP_DIR"
```

**Incremental Backup (Hourly)**:
```bash
#!/bin/bash
# backup-kaseki-incremental.sh - runs hourly via cron

BACKUP_DIR="/backups/kaseki/incremental/$(date +%Y-%m-%d_%H)"
mkdir -p "$BACKUP_DIR"

# Backup only new/modified files from last 90 minutes
find /agents/kaseki-results -type f -mmin -90 | \
  tar -czf "$BACKUP_DIR/kaseki-results-incremental.tar.gz" -T -

# Cleanup old incremental backups (keep 3 days)
find /backups/kaseki/incremental -mtime +3 -delete
```

### Health Checks (Automated Monitoring)

```bash
#!/bin/bash
# health-check.sh - runs every 5 minutes via cron

API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health)

if [[ "$API_HEALTH" != "200" ]]; then
  echo "⚠️ API health check failed: $API_HEALTH"
  
  # Alert SRE team
  curl -X POST $SLACK_WEBHOOK \
    -d '{"text": "⚠️ Kaseki API health check failed"}'
  
  # Restart if necessary
  if [[ "$API_HEALTH" == "000" ]]; then
    docker-compose restart kaseki-api
  fi
fi

# Check disk space
DISK_USAGE=$(df /agents | awk 'NR==2 {print $5}' | cut -d'%' -f1)
if [[ $DISK_USAGE -gt 90 ]]; then
  echo "⚠️ Disk usage critical: $DISK_USAGE%"
  # Trigger alert and cleanup old runs
  rm -rf /agents/kaseki-results/kaseki-{old-uuid-1,old-uuid-2}/
fi
```

---

## Incident Playbooks

### Incident 1: API Won't Start

**Symptom**: Docker container fails on startup

**Diagnosis**:
```bash
# Check logs
docker-compose logs kaseki-api --tail 50

# Common issues:
docker logs kaseki-api 2>&1 | grep -i "error\|failed\|permission"

# Check port availability
lsof -i :8080
```

**Recovery**:

**Option A: Permission Error**
```bash
# Fix directory permissions
sudo chown -R 10000:10000 /agents/kaseki-results
sudo chmod 755 /agents
docker-compose restart kaseki-api
```

**Option B: Docker Daemon Issue**
```bash
# Restart Docker daemon
sudo systemctl restart docker
docker-compose up -d kaseki-api
```

**Option C: Configuration Error**
```bash
# Verify environment variables
docker-compose config | grep -i kaseki_

# Fix .env or docker-compose.yml, then:
docker-compose restart kaseki-api
```

### Incident 2: /agents Directory Corrupted

**Symptom**: Files missing, unreadable, or checksums don't match

**Diagnosis**:
```bash
# Check filesystem integrity
sudo fsck -n /dev/sda1  # Read-only check

# Verify backup exists
ls -la /backups/kaseki/*/kaseki-results.tar.gz
```

**Recovery**:

**Step 1**: Stop API service
```bash
docker-compose down
```

**Step 2**: Restore from backup
```bash
LATEST_BACKUP=$(ls -t /backups/kaseki/*/kaseki-results.tar.gz | head -1)

# Move corrupted directory
mv /agents/kaseki-results /agents/kaseki-results.corrupted

# Restore
mkdir -p /agents
tar -xzf "$LATEST_BACKUP" -C /
```

**Step 3**: Restart and verify
```bash
docker-compose up -d kaseki-api
curl -s http://localhost:8080/health | jq .
```

**Step 4**: Post-mortem
- What caused the corruption?
- Can we prevent it? (better monitoring, hardware checks)
- Update runbook based on findings

### Incident 3: API Key Expired/Rotated

**Symptom**: Runs fail with "Unauthorized" or "Invalid API key"

**Diagnosis**:
```bash
# Check stored key
echo $OPENROUTER_API_KEY  # Should be present
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  https://api.openrouter.ai/api/v1/models  # Test auth
```

**Recovery**:

**Step 1**: Obtain new API key from OpenRouter dashboard

**Step 2**: Update secret (if using Docker secrets)
```bash
# Update secret
echo "sk-or-new-key-here" | docker secret create openrouter_api_key -

# Update docker-compose to use the secret
docker-compose restart kaseki-api
```

**Step 2b**: Update environment variable (if using env file)
```bash
# Update ~/.kaseki-env or /etc/kaseki/env
export OPENROUTER_API_KEY="sk-or-new-key-here"

# Source it
source ~/.kaseki-env
docker-compose restart kaseki-api
```

**Step 3**: Verify
```bash
# Test a small kaseki run
./run-kaseki.sh kaseki-verify-1

# Check if it succeeds
cat /agents/kaseki-results/kaseki-verify-1/metadata.json | jq .exit_codes.overall
```

### Incident 4: Docker Daemon Crash

**Symptom**: Docker commands hang or fail; containers not responding

**Diagnosis**:
```bash
docker ps  # Hangs or fails

# Check daemon status
sudo systemctl status docker
sudo journalctl -u docker --no-pager | tail -20
```

**Recovery**:

**Step 1**: Restart daemon
```bash
sudo systemctl restart docker

# Wait for startup
sleep 10
docker ps  # Should work now
```

**Step 2**: Restart kaseki containers
```bash
docker-compose restart kaseki-api kaseki-worker
```

**Step 3**: Monitor for stability
```bash
# Watch logs for errors
docker-compose logs -f kaseki-api
```

### Incident 5: Storage/Filesystem Unavailable

**Symptom**: /agents is unmounted or inaccessible

**Diagnosis**:
```bash
df -h  # Check if /agents shows up
ls -la /agents  # Try to access

# If NFS mount:
showmount -a nfs-server.example.com
```

**Recovery**:

**Step 1**: Stop services
```bash
docker-compose down
```

**Step 2**: Remount storage
```bash
# If NFS
sudo mount -t nfs nfs-server.example.com:/srv/kaseki-results /agents

# If local disk with bad mount:
sudo mount -a  # Remount all filesystems

# Verify
df -h | grep kaseki
```

**Step 3**: Restart services
```bash
docker-compose up -d
```

### Incident 6: Queue Backup (Runs Stuck)

**Symptom**: Many runs stuck in "pending" state; new requests queue up

**Diagnosis**:
```bash
# Check queue status
curl -s http://localhost:8080/status | jq '.queue'

# Check stuck worker
docker-compose logs kaseki-worker | grep -i "stuck\|hang\|error"

# List pending runs
cat /agents/kaseki-results/*/metadata.json | jq '. | select(.status == "pending")'
```

**Recovery**:

**Option A: Increase concurrency**
```bash
# Allow more concurrent runs
export KASEKI_API_MAX_CONCURRENT_RUNS=5

# Restart API
docker-compose restart kaseki-api

# Runs should start processing
```

**Option B: Clear stuck run**
```bash
# Identify stuck kaseki-N
STUCK_RUN="kaseki-12345"

# Mark as failed
echo "1" > /agents/kaseki-results/$STUCK_RUN/exit_code

# Restart API
docker-compose restart kaseki-api
```

**Option C: Restart worker**
```bash
# Kill and restart worker (will drop in-flight run)
docker-compose restart kaseki-worker
```

### Incident 7: Entire Host Failure

**Symptom**: Host is unreachable or crashed; all services down

**Diagnosis**:
```bash
ping example.com  # Can we reach it?
ssh user@example.com "uptime"  # Try SSH
```

**Recovery** (assuming multi-host setup):

**Step 1**: Failover to secondary host
```bash
# Update DNS/load balancer
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123 \
  --change-batch "$(cat << 'EOF'
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "kaseki.example.com",
      "Type": "A",
      "TTL": 60,
      "ResourceRecords": [{"Value": "10.0.2.10"}]
    }
  }]
}
EOF
)"
```

**Step 2**: Restore on new host
```bash
# Spin up new VM with same configuration
terraform apply  # Or your IaC tool

# Restore from backup
LATEST_BACKUP=$(aws s3 ls s3://kaseki-backups/ --recursive | tail -1 | awk '{print $4}')
aws s3 cp "s3://kaseki-backups/$LATEST_BACKUP" /tmp/
tar -xzf /tmp/kaseki-results.tar.gz -C /

# Start services
docker-compose up -d
```

**Step 3**: Investigate original host
```bash
# Once recovered, determine root cause
# Update runbook to prevent recurrence
```

---

## Backup & Restore Procedures

### Full System Restore

```bash
#!/bin/bash
# restore-kaseki-full.sh

BACKUP_PATH=$1  # e.g., /backups/kaseki/2026-05-10

if [[ ! -d "$BACKUP_PATH" ]]; then
  echo "❌ Backup not found: $BACKUP_PATH"
  exit 1
fi

echo "🔄 Restoring from $BACKUP_PATH..."

# Step 1: Stop services
docker-compose down

# Step 2: Restore data
tar -xzf "$BACKUP_PATH/kaseki-results.tar.gz" -C /

# Step 3: Restore configuration
tar -xzf "$BACKUP_PATH/kaseki-config.tar.gz" -C /

# Step 4: Restore Docker image (if needed)
docker load < "$BACKUP_PATH/kaseki-image.tar.gz"

# Step 5: Restart services
docker-compose up -d

# Step 6: Verify
sleep 5
curl -s http://localhost:8080/health | jq .

echo "✅ Restore complete"
```

### Selective Restore (Specific Runs)

```bash
#!/bin/bash
# restore-kaseki-runs.sh - restore only specific kaseki runs

BACKUP_PATH=$1
RUN_IDS=$2  # Space-separated, e.g., "kaseki-1 kaseki-2"

for RUN_ID in $RUN_IDS; do
  echo "Restoring $RUN_ID..."
  
  # Extract only this run from backup
  tar -xzf "$BACKUP_PATH/kaseki-results.tar.gz" \
    "agents/kaseki-results/$RUN_ID/" -C /
  
  echo "✅ Restored $RUN_ID"
done
```

---

## Post-Incident Review Template

```markdown
# Post-Incident Review: [Incident Name]

## Timeline

| Time | Event |
|------|-------|
| 14:05 | Alert: API health check failed |
| 14:10 | Incident commander notified |
| 14:20 | Root cause identified: disk full |
| 14:35 | Old runs deleted; API restarted |
| 14:40 | System back to normal |

**Total Duration**: 35 minutes

## Root Cause

Automatic cleanup of old runs not running due to cron job failure.
Disk filled up over 2 weeks, causing writes to fail.

## Impact

- 18 runs failed or were delayed
- API unavailable for 35 minutes
- No data loss (all artifacts preserved)

## Remediation

1. ✅ Fixed cron job permission issue
2. ✅ Added disk space monitoring with 85% alert threshold
3. ✅ Implemented automatic cleanup (keep only 30 days of results)

## Action Items

- [ ] Update runbook with disk monitoring steps
- [ ] Set up automated alerts for disk usage > 85%
- [ ] Implement backup rotation to prevent filling secondary storage
- [ ] Schedule disaster recovery drill for Q3

## Prevention

- Implement disk space monitoring alerting
- Add disk usage to health checks
- Document retention policy for kaseki artifacts
```

---

## Runbook Checklist

**For Each Critical System Component**:

- [ ] Backup procedure (frequency, location, verification)
- [ ] Health check procedure (automated + manual)
- [ ] Failure diagnosis steps
- [ ] Recovery procedure (step-by-step)
- [ ] Verification after recovery
- [ ] Escalation contacts
- [ ] Expected RTO (recovery time) and RPO (recovery point)

---

## See Also

- [DISASTER_RECOVERY.md](../../docs/DISASTER_RECOVERY.md) — Complete disaster recovery guide
- [distributed-deployment](distributed-deployment.md) — Multi-host failover setup
- [workflow-diagnosis](workflow-diagnosis.md) — Diagnosing failures
- [DEPLOYMENT.md](../../docs/DEPLOYMENT.md) — Basic deployment setup
