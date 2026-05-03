const fs = require('fs');

const filePath = 'src/kaseki-api-routes.test.ts';
let content = fs.readFileSync(filePath, 'utf-8');

// Pattern to find all createApiRouter calls with old signature
const pattern = /app\.use\('\/api', createApiRouter\(scheduler, \{\s*port: 0.*?\}\)\);/gs;

let matches = [];
let match;
while ((match = pattern.exec(content)) !== null) {
  matches.push({ text: match[0], index: match.index });
}

console.log(`Found ${matches.length} matches to fix`);

// Replace all instances
matches.forEach((_m, _idx) => {
  const oldText = _m.text;
  const configMatch = oldText.match(/\{\s*(port: 0.*?)\s*\}/s);
  if (configMatch) {
    const configContent = configMatch[1];
    const newText = `const config = {
      ${configContent},
    };

    const idempotencyStore = new IdempotencyStore(resultsDir, 24);
    const preFlightValidator = new PreFlightValidator();

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(scheduler, config, idempotencyStore, preFlightValidator));`;

    // Find the preceding lines to get full context
    const beforeMatch = oldText.match(/const scheduler = \{[\s\S]*\} as any;/s);
    if (beforeMatch) {
      const fullMatch = beforeMatch[0] + '\n\n    ' + oldText;
      const replacement = beforeMatch[0] + '\n\n    ' + newText;
      content = content.replace(fullMatch, replacement);
    }
  }
});

fs.writeFileSync(filePath, content);
console.log('Done!');
