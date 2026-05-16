# Disaster Recovery & Failure Playbooks

> **NPM CLI note:** `kaseki-agent run` is API-backed in the npm package. Start a local API service or set `KASEKI_API_URL` before running recovery examples that submit new work.

This guide provides procedures for recovering from common failure scenarios and restoring service after incidents.

---

## Before an Incident: Preparation

### Backup Strategy

```bash
# Daily backup of /agents/kaseki-results to S3
0 2 * * * \
  tar czf /tmp/kaseki-backup-$(date +\%Y\%m\%d).tar.gz \
    /agents/kaseki-results && \
  aws s3 cp /tmp/kaseki-backup-*.tar.gz \
    s3://kaseki-backups/ && \
  rm /tmp/kaseki-backup-*.tar.gz

# Keep 30 days of backups
aws s3 ls s3://kaseki-backups/ | awk '{print $4}' | \
  sort | head -n -30 | \
  while read file; do aws s3 rm "s3://kaseki-backups/$file"; done
```

### Health Check Monitoring

```bash
# Monitor health every 60 seconds
* * * * * curl -f http://localhost:8080/health || \
  echo "Kaseki API unhealthy at $(date)" >> /var/log/kaseki-health.log
```

### Documentation

- Keep runbooks for common incidents
- Maintain list of team contact info (for escalation)
- Document all custom configurations

---

## Incident Scenarios & Recovery

### Scenario 1: API Service Won't Start

**Symptoms:**

- `docker-compose up` fails immediately
- Error: permission denied, port in use, or container crash

**Diagnosis:**

```bash
# Check Docker status
docker-compose ps
docker-compose logs kaseki-api --tail 50

# Common causes
docker ps | grep kaseki  # Check if already running
sudo lsof -i :8080      # Check if port in use
ls -ld /agents          # Check directory permissions
```

**Recovery:**

```bash
# If port conflict
sudo lsof -ti :8080 | xargs kill -9
# Or use alternate port
export KASEKI_API_PORT=8081

# If permission denied on /agents
sudo chmod 777 /agents

# If container crashes
docker-compose logs kaseki-api | tail -100
# Fix underlying issue, then restart
docker-compose down
docker-compose up -d
```

---

### Scenario 2: /agents Directory Corrupted

**Symptoms:**

- Permission denied writing to /agents/kaseki-results
- Disk space full
- Filesystem errors in dmesg

**Diagnosis:**

```bash
# Check filesystem
df -h /agents
fsck -n /agents  # Non-destructive check

# Check permissions
ls -ld /agents
ls -ld /agents/kaseki-results

# Check for orphaned files
find /agents -type f -newermt '30 days ago' ! -newermt 'now' |
  wc -l
```

**Recovery:**

```bash
# If permission issue
sudo chown 10000:10000 /agents
sudo chmod 755 /agents

# If disk full
# Archive old runs
find /agents/kaseki-results -type d -newermt '60 days ago' \
  -delete

# If filesystem corrupted (dangerous operation)
# Requires downtime
docker-compose down
sudo fsck -y /dev/xxx  # Device hosting /agents
docker-compose up -d

# Restore from backup if needed
# (see "Backup & Restore" section)
```

---

### Scenario 3: OpenRouter API Key Expired/Invalid

**Symptoms:**

- Exit code 1 (generic failure)
- Logs show "401 Unauthorized" or "Invalid API key"
- Agent phase fails immediately

**Diagnosis:**

```bash
# Check if key is readable
test -f /agents/secrets/openrouter_api_key && \
  echo "✓ Key file exists"

# Test key validity
curl -H "Authorization: Bearer $(cat /agents/secrets/openrouter_api_key)" \
  https://openrouter.ai/api/v1/models | jq '.error'
```

**Recovery:**

```bash
# Update key
echo "sk-or-new-key-here" > /agents/secrets/openrouter_api_key
chmod 600 /agents/secrets/openrouter_api_key

# Restart API service
docker-compose restart kaseki-api

# Re-run failed tasks
kaseki-agent run $REPO $REF "$TASK"
```

---

### Scenario 4: Docker Daemon Crash

**Symptoms:**

- `docker ps` hangs or fails
- Cannot start/stop containers
- dmesg shows kernel errors

**Diagnosis:**

```bash
# Check Docker status
systemctl status docker
docker ps

# Check Docker logs
journalctl -u docker -n 50
```

**Recovery:**

```bash
# Restart Docker daemon
sudo systemctl restart docker

# Verify recovery
docker ps
docker-compose ps

# If Docker won't restart
sudo systemctl start docker || \
  sudo systemctl start docker.service
```

---

### Scenario 5: Database/Storage Unavailable (Distributed Deployments)

**Symptoms:**

- NFS mount unavailable
- S3 access denied
- Redis connection timeout

**Diagnosis (NFS):**

```bash
# Check mount
df -h /agents/kaseki-results
mount | grep kaseki

# Check NFS server
nfs-client-stat  # or appropriate utility
rpcinfo -p nfs-server
```

**Recovery (NFS):**

```bash
# Remount
sudo umount /agents/kaseki-results 2>/dev/null
sudo mount /agents/kaseki-results

# If NFS server is down
# Fail over to secondary (if configured)
# Or use local /agents temporarily (results won't persist)
```

**Diagnosis (S3):**

```bash
# Test S3 access
aws s3 ls s3://kaseki-results/

# Check credentials
aws sts get-caller-identity
```

**Recovery (S3):**

```bash
# Verify AWS credentials
cat ~/.aws/credentials

# If using IAM role, check role trust relationship
aws iam get-role --role-name kaseki-agent-role

# Restart API to pick up new credentials
docker-compose restart kaseki-api
```

---

### Scenario 6: Rollback a Failed Agent Run

**Symptoms:**

- Agent made unintended changes
- PR created with bad code
- Need to undo changes

**Diagnosis:**

```bash
# Review what changed
cat /agents/kaseki-results/kaseki-N/git.diff |
  head -100

# Check if PR was created
gh pr list --search "kaseki"
```

**Recovery:**

```bash
# Option 1: Revert the PR (if merged)
git revert <commit-hash>
git push

# Option 2: Force-push original state (dangerous, use with caution)
git reset --hard <original-commit>
git push -f origin <branch>

# Option 3: Create manual fix PR
git checkout -b fix-kaseki-changes
# Manually fix the broken changes
git commit -m "Fix: Revert unintended Kaseki changes"
git push origin fix-kaseki-changes
# Create PR to original branch
```

---

### Scenario 7: Agent Timeout Causing Queue Backup

**Symptoms:**

- Many runs stuck in "running" state
- Queue not processing
- OpenRouter rate limits hit

**Diagnosis:**

```bash
# Check running jobs
curl http://localhost:8080/health | jq '.queue'

# Check oldest running job
find /agents/kaseki-results -type f -name metadata.json | \
  xargs ls -lt | head -1

# Check if stuck
cat /agents/kaseki-results/kaseki-N/pi-summary.json |
  jq '.elapsed_seconds, .timeout_seconds'
```

**Recovery:**

```bash
# Cancel stuck jobs (if implementation supports)
# (Currently requires manual intervention)

# Increase timeout for new jobs
export KASEKI_AGENT_TIMEOUT_SECONDS=3600

# Reduce concurrency to avoid rate limits
export KASEKI_API_MAX_CONCURRENT_RUNS=1
docker-compose restart kaseki-api

# Process queue slowly
while curl -s http://localhost:8080/health | \
  jq -r '.queue.pending' | grep -q '[1-9]'; do
  echo "Processing queue..."
  sleep 60
done
```

---

### Scenario 8: Entire Host Failure

**Symptoms:**

- Host unreachable
- Cannot SSH to host
- Monitoring shows no heartbeat

**Diagnosis (Remote):**

```bash
# Test connectivity
ping host.example.com
ssh -v root@host.example.com

# Check cloud provider status
# (e.g., AWS console, GCP console)
```

**Recovery:**

```bash
# In single-host deployment:
# 1. Provision new host
# 2. Restore /agents from backup
# 3. Deploy docker-compose
# 4. Verify results are available

# Restore from backup
aws s3 cp s3://kaseki-backups/kaseki-backup-20260501.tar.gz /tmp/
tar xzf /tmp/kaseki-backup-20260501.tar.gz -C /

# In multi-host deployment:
# Requests automatically failover to healthy host
# No action needed; failed host will be replaced when convenient
```

---

## Backup & Restore Procedures

### Full Results Backup

```bash
#!/bin/bash
# backup-kaseki.sh

BACKUP_DIR="/backups/kaseki"
DATE=$(date +%Y%m%d-%H%M%S)

mkdir -p $BACKUP_DIR

# Backup to local directory
tar czf $BACKUP_DIR/kaseki-results-$DATE.tar.gz \
  /agents/kaseki-results

# Backup to S3
aws s3 cp $BACKUP_DIR/kaseki-results-$DATE.tar.gz \
  s3://kaseki-backups/

echo "Backup complete: kaseki-results-$DATE.tar.gz"
```

### Restore from Backup

```bash
#!/bin/bash
# restore-kaseki.sh

BACKUP_FILE="$1"  # e.g., kaseki-results-20260501.tar.gz

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Stop API service
docker-compose down

# Restore from backup
tar xzf "$BACKUP_FILE" -C /

# Restart service
docker-compose up -d

echo "Restore complete from $BACKUP_FILE"
```

### Selective Recovery

```bash
# Recover a single run
tar xzf kaseki-backup-20260501.tar.gz \
  --wildcards "kaseki-results/kaseki-5/*" \
  -C /agents

# Recover multiple runs by date
tar tzf kaseki-backup-20260501.tar.gz | \
  grep "kaseki-[0-9]\+/" | \
  cut -d/ -f2 | sort -u | \
  while read run; do
    tar xzf kaseki-backup-20260501.tar.gz \
      "kaseki-results/$run/" -C /agents
  done
```

---

## Post-Incident Review

After any incident, perform a review:

```markdown
## Incident Report

**Date/Time:** [when it occurred]
**Duration:** [how long it lasted]
**Impact:** [what services were affected]

### Root Cause
[Why did it happen?]

### Detection
[How was it detected? How long before discovery?]

### Resolution
[What fixed it?]

### Timeline
- HH:MM - Event occurred
- HH:MM - Problem detected
- HH:MM - Investigation started
- HH:MM - Fix applied
- HH:MM - Service restored

### Preventive Actions
- [What should we do to prevent recurrence?]
- [What monitoring should we add?]
- [What documentation should we improve?]

### Owner
[Who leads the follow-up?]
```

---

## Incident Contact & Escalation

```
Tier 1 (API service issues):
  - On-call engineer (PagerDuty: #kaseki-oncall)
  - Slack: #kaseki-incidents

Tier 2 (Persistent issues):
  - Team lead (email: kaseki-leads@example.com)
  - Escalate if Tier 1 unresponsive after 30 minutes

Tier 3 (Data loss / critical):
  - Engineering director
  - CTO
  - Activate incident commander
```

---

## Runbook Checklist

- [ ] Backup strategy tested (monthly)
- [ ] Restore procedure tested (monthly)
- [ ] Health checks configured and tested
- [ ] Monitoring alerts configured
- [ ] Escalation contacts documented and current
- [ ] Post-incident review process established
- [ ] Runbooks reviewed (quarterly)

---

## See Also

- [DEPLOYMENT.md](DEPLOYMENT.md) — Normal deployment procedures
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — General troubleshooting
- [DISTRIBUTED_SETUP.md](DISTRIBUTED_SETUP.md) — Multi-host failover
