# Sentry Integration Guide

Complete guide to integrating and using Sentry for error tracking and monitoring with kaseki-agent.

## Overview

Sentry is an error tracking platform that helps you monitor and debug production issues. Kaseki-agent integrates with Sentry to automatically capture and report:

- **Uncaught exceptions** in the API service
- **Unhandled promise rejections**
- **Express middleware errors**
- **Request context** for debugging
- **Custom error events** with breadcrumbs

## Getting Started

### 1. Create a Sentry Account

1. Visit [sentry.io](https://sentry.io) and sign up
2. Create a new organization (or use existing)
3. Create a new project:
   - **Platform**: Node.js
   - **Name**: kaseki-agent

### 2. Get Your DSN

After creating the project, you'll see your **Data Source Name (DSN)**:

```
https://xxx@o1234567890.ingest.sentry.io/9876543210
```

This is your unique identifier for the Kaseki project in Sentry.

### 3. Configure Kaseki

Set the Sentry DSN in your environment:

```bash
# Local API or Production API
export SENTRY_DSN=https://xxx@o1234567890.ingest.sentry.io/9876543210

# Recommended for production
export SENTRY_ENVIRONMENT=production
export SENTRY_SAMPLE_RATE=0.1  # 10% transaction sampling
```

### 4. Start the API Service

For Docker Compose:

```bash
docker-compose up -d kaseki-api
```

For Node.js:

```bash
npm run kaseki-api
```

Sentry will now capture any errors and report them to your Sentry project.

## Configuration Reference

All Sentry configuration is optional and controlled by environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SENTRY_DSN` | — | Enable Sentry error tracking |
| `SENTRY_ENVIRONMENT` | `development` | Environment label in Sentry |
| `SENTRY_RELEASE` | Auto-detected | Version/release label |
| `SENTRY_SAMPLE_RATE` | `0.1` | Transaction sampling (0.0-1.0) |
| `SENTRY_ENABLED` | Auto-detect | Explicitly enable/disable |

See [docs/ADVANCED_CONFIG.md](ADVANCED_CONFIG.md#monitoring-zone-sentry) for detailed configuration.

## Using Sentry

### Viewing Errors in the Dashboard

1. Log in to [sentry.io](https://sentry.io)
2. Navigate to your **kaseki-agent** project
3. You'll see:
   - **Issues** tab: All errors grouped by type
   - **Performance** tab: Transaction timing and stats
   - **Releases** tab: Error tracking by version
   - **Alerts** tab: Notification rules

### Error Details

Each error shows:

- **Stack trace**: Where the error occurred
- **Breadcrumbs**: Events leading up to the error (requests, logs, custom events)
- **Release**: Which version of kaseki-agent had the error
- **Environment**: Which environment (dev/staging/prod)
- **Request context**: HTTP method, URL, headers (if applicable)

### Grouping and Fingerprinting

Sentry automatically groups similar errors. You can:

- **Ignore** errors you don't care about
- **Resolve** errors that are fixed
- **Merge** duplicate error groups
- **Create custom fingerprints** for better grouping

### Setting Up Alerts

Create alerts to notify your team:

1. Go to **Alerts** > **Create Alert**
2. Configure trigger:
   - Error count threshold
   - Time window
   - Environment filter
3. Set notification channels:
   - Email
   - Slack
   - PagerDuty
   - Webhooks

Example: Alert when production errors exceed 5 in 5 minutes.

## Programmatic Error Reporting

In addition to automatic error capture, you can report custom errors and events:

### From kaseki-agent CLI

The Sentry integration is built into the API service. Errors are automatically captured.

### From External Code

If you're integrating kaseki-agent into your own code:

```typescript
import { captureException, addBreadcrumb } from '@cyanautomation/kaseki-agent';

try {
  // Your code
} catch (error) {
  // Report to Sentry with context
  captureException(error, {
    task: 'my-task',
    jobId: 'kaseki-123',
  });
}

// Add debugging info
addBreadcrumb('Task started', 'task', 'info', { jobId: 'kaseki-123' });
```

See [src/sentry-integration.ts](../src/sentry-integration.ts) for full API.

## Performance Monitoring

Sentry tracks transaction performance by default:

- **API request latency**: How long each endpoint takes
- **Database queries**: (if added in future)
- **Custom spans**: Wrap expensive operations

View performance metrics in the **Performance** tab:

```
/api/run             | 245ms avg | 89% <= 500ms
/api/logs/:jobId     | 12ms avg  | 100% <= 100ms
/api/artifacts/:id   | 450ms avg | 75% <= 1000ms
```

### Adjusting Transaction Sampling

To reduce costs while monitoring performance:

```bash
# Sample 5% of transactions (only high-cost production setups)
SENTRY_SAMPLE_RATE=0.05

# Sample all transactions in development
SENTRY_SAMPLE_RATE=1.0 SENTRY_ENVIRONMENT=development

# Don't sample, only capture errors (minimal cost)
SENTRY_SAMPLE_RATE=0.0
```

## Troubleshooting

### Sentry Not Receiving Events

**Check if Sentry is initialized:**

```bash
# Look for this log on startup
docker-compose logs kaseki-api | grep -i sentry
```

Expected output:

```
Sentry initialized
  enabled: true
  environment: production
```

**Verify DSN is correct:**

1. Check `SENTRY_DSN` environment variable is set
2. Confirm DSN format: `https://key@organization.ingest.sentry.io/project`
3. Ensure DSN is not expired (check Sentry project settings)

**Check network connectivity:**

If behind a proxy, you may need to configure SSL settings:

```bash
# Disable SSL verification (not recommended for production)
NODE_TLS_REJECT_UNAUTHORIZED=0

# Or configure proxy
HTTP_PROXY=http://proxy.example.com:8080
HTTPS_PROXY=http://proxy.example.com:8080
```

### High Sentry Costs

If you're seeing higher-than-expected Sentry charges:

1. **Reduce transaction sampling**:

   ```bash
   SENTRY_SAMPLE_RATE=0.01  # 1% instead of 10%
   ```

2. **Filter noisy errors**:
   - Go to Sentry project settings > **Inbound Data Filters**
   - Ignore errors by pattern (e.g., 404s, health checks)

3. **Set release filters**:
   - Only track errors from specific kaseki-agent versions
   - Ignore pre-release versions

### Missing Breadcrumbs

If you're not seeing request context in error reports:

1. Ensure Express integration is enabled (automatic)
2. Check if error happens during request handling
3. Note: Some async contexts may not have request data

## Best Practices

### 1. Use Environments

Always set `SENTRY_ENVIRONMENT` to distinguish local/staging/production:

```bash
# Development machine
SENTRY_ENVIRONMENT=development SENTRY_SAMPLE_RATE=1.0

# Staging
SENTRY_ENVIRONMENT=staging SENTRY_SAMPLE_RATE=0.5

# Production
SENTRY_ENVIRONMENT=production SENTRY_SAMPLE_RATE=0.1
```

### 2. Set Release Version

Link errors to specific code versions:

```bash
# In your CI/CD
SENTRY_RELEASE=$(git describe --tags --always)
docker-compose up -d kaseki-api
```

This helps you:

- Know which versions have errors
- Resolve issues when fixed in new releases
- Compare error rates across versions

### 3. Monitor Error Trends

In the Sentry dashboard:

1. Set up a **saved search** for your errors
2. Add to **custom dashboard** for quick visibility
3. Watch for **spikes** in error rates

### 4. Create Meaningful Alerts

Configure alerts for:

- **Production errors**: Alert immediately (email + Slack)
- **Staging errors**: Daily digest
- **Development errors**: Ignore (too noisy)

### 5. Regular Cleanup

Keep Sentry noise low:

- **Resolve fixed errors** (don't ignore, resolve)
- **Merge duplicate groups** manually
- **Delete test/dummy errors** if captured
- **Adjust release retention** to save costs

## Security

### DSN Privacy

The Sentry DSN contains your organization and project IDs. While not a secret like an API key, keep it out of:

- Public documentation
- Git repositories
- GitHub issues
- Email
- Chat channels

### Data Retention

By default, Sentry keeps error data for 90 days. Adjust in:

**Sentry Settings** > **Data Retention**

Options:

- 30 days (minimum, cheapest)
- 90 days (default)
- 1 year
- Unlimited

## Advanced Usage

### Custom Context

Track additional metadata with errors:

```typescript
import { setTags, setExtraContext } from '@cyanautomation/kaseki-agent';

setTags({
  component: 'api-routes',
  repository: 'cyanautomation/crudmapper',
});

setExtraContext({
  jobId: 'kaseki-123',
  taskType: 'parser-fix',
  agentModel: 'openai/gpt-4',
});
```

### User Identification

Track which users/clients trigger errors:

```typescript
import { setUserContext } from '@cyanautomation/kaseki-agent';

// On request with API key
setUserContext('api-client-xyz', {
  username: 'service-account-1',
  ipAddress: req.ip,
});

// On logout
clearUserContext();
```

### Source Maps

For production, upload source maps so errors point to original TypeScript:

```bash
# In CI/CD after building
npm install @sentry/cli

sentry-cli releases -o myorg -p kaseki-agent files upload-sourcemaps dist/
```

## Support

- **Sentry Documentation**: <https://docs.sentry.io/platforms/javascript/guides/node/>
- **Kaseki Issues**: <https://github.com/CyanAutomation/kaseki-agent/issues>
- **Sentry Support**: <https://sentry.io/support/>

## Changelog

### v1.54.0

- ✅ Initial Sentry integration for kaseki-agent API service
- ✅ Automatic error capture for uncaught exceptions
- ✅ Express middleware error tracking
- ✅ Environment-based configuration
- ✅ Performance monitoring with transaction sampling
