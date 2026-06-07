/**
 * Integration test: Demonstrates Feature 3 summarization in action
 * Shows how kaseki-agent can use the summarization module
 */

import { readFileWithSummary, readFileWithSummaryAndMetrics } from './summarization/read-wrapper.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function runIntegrationTest() {
  console.log('=== Feature 3 Summarization Integration Test ===\n');

  // Create a test TypeScript file
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-integration-'));
  const testFile = path.join(testDir, 'example-service.ts');

  const serviceCode = `
import { Repository } from './repository';
import { Logger } from './logger';

/**
 * User service handles all user-related operations
 */
export interface UserRequest {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export class UserService {
  constructor(
    private repository: Repository,
    private logger: Logger
  ) {}

  async getUser(id: number): Promise<UserRequest | null> {
    this.logger.debug(\`Fetching user \${id}\`);
    const user = await this.repository.findById(id);
    if (!user) {
      this.logger.warn(\`User \${id} not found\`);
      return null;
    }
    return user;
  }

  async createUser(data: Partial<UserRequest>): Promise<UserRequest> {
    this.logger.info(\`Creating user: \${data.name}\`);
    const user = await this.repository.create(data);
    this.logger.info(\`User created with ID \${user.id}\`);
    return user;
  }

  async updateUser(id: number, data: Partial<UserRequest>): Promise<UserRequest> {
    this.logger.info(\`Updating user \${id}\`);
    const user = await this.repository.update(id, data);
    this.logger.info(\`User \${id} updated\`);
    return user;
  }

  async deleteUser(id: number): Promise<boolean> {
    this.logger.warn(\`Deleting user \${id}\`);
    const result = await this.repository.delete(id);
    this.logger.info(\`User \${id} deleted: \${result}\`);
    return result;
  }
}

export function createUserService(repo: Repository, logger: Logger): UserService {
  return new UserService(repo, logger);
}
`;

  fs.writeFileSync(testFile, serviceCode);

  console.log('1. Testing readFileWithSummary (content only)');
  console.log('   File:', testFile);
  console.log('   File size:', fs.statSync(testFile).size, 'bytes');
  console.log('   File exists:', fs.existsSync(testFile));

  try {
    const content = await readFileWithSummary(testFile);
    console.log(`   ✓ Content read successfully (${content?.length || 0} bytes)`);
    if (content) {
      console.log('   First 100 chars:', content.substring(0, 100) + '...');
    }
  } catch (error) {
    console.log('   ✗ Error:', error instanceof Error ? error.message : error);
  }

  console.log('\n2. Testing readFileWithSummaryAndMetrics (with metadata)');

  try {
    const result = await readFileWithSummaryAndMetrics(testFile);
    if (result) {
      console.log('   ✓ Content + metrics read successfully');
      console.log(`   - Has metrics: ${result.metrics ? 'yes' : 'no'}`);
      if (result.metrics) {
        console.log(`   - Strategy: ${result.metrics.strategy}`);
        console.log(`   - Language: ${result.metrics.language}`);
        console.log(`   - Original size: ${result.metrics.fullSizeBytes} bytes`);
        console.log(`   - Returned size: ${result.metrics.returnedSizeBytes} bytes`);
        console.log(`   - Compression ratio: ${result.metrics.compressionRatio.toFixed(2)}:1`);
        console.log(`   - Parse time: ${result.metrics.parseTimeMs}ms`);
        console.log(`   - Decision path: ${result.metrics.decisionPath}`);
        console.log(`   - Reason: ${result.metrics.strategyReason}`);
      } else {
        console.log(`   - Content size: ${result.content?.length || 0} bytes`);
      }
    } else {
      console.log('   ✗ No result returned');
    }
  } catch (error) {
    console.log('   ✗ Error:', error instanceof Error ? error.message : error);
  }

  console.log('\n3. Testing with --full option (force full read)');

  try {
    const result = await readFileWithSummaryAndMetrics(testFile, { full: true });
    if (result) {
      console.log('   ✓ Full read forced');
      console.log(`   - Strategy: ${result.metrics?.strategy}`);
      console.log(`   - Content size: ${result.metrics?.returnedSizeBytes} bytes`);
    }
  } catch (error) {
    console.log('   ✗ Error:', error instanceof Error ? error.message : error);
  }

  console.log('\n4. Testing error handling');

  try {
    const result = await readFileWithSummary('/nonexistent/file.ts');
    console.log('   ✓ Error handled gracefully, result:', result);
  } catch (error) {
    console.log('   ✗ Unexpected error:', error instanceof Error ? error.message : error);
  }

  // Cleanup
  fs.rmSync(testDir, { recursive: true });

  console.log('\n=== Integration Test Complete ===');
}

// Run the test
runIntegrationTest().catch(console.error);
