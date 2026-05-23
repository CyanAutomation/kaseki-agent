const mod = require('./src/kaseki-api-web.ts');
const router = mod.createWebRouter();
const express = require('express');
const app = express();
app.use(router);
const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/ui`);
  const body = await res.text();
  
  // Test the regex pattern
  const pattern = /function requestBody\(\) \{([\s\S]*?)\n{6}\}/;
  const match = body.match(pattern);
  console.log('Regex matches:', match ? 'YES!' : 'NO');
  
  // Get the function to analyze
  const funcIdx = body.indexOf('function requestBody() {');
  if (funcIdx >= 0) {
    const afterFunc = body.substring(funcIdx);
    const nextFunc = afterFunc.indexOf('async function');
    const funcContent = afterFunc.substring(0, nextFunc);
    
    // Show the end of the function
    const endPortion = funcContent.substring(funcContent.length - 100);
    console.log('\nLast 100 chars of function:');
    console.log(JSON.stringify(endPortion));
    
    // Find the function's closing brace
    const lines = funcContent.split('\\n');
    console.log('\nLast lines:');
    for (let i = Math.max(0, lines.length - 15); i < lines.length; i++) {
      console.log(`Line ${i}: ${JSON.stringify(lines[i])}`);
    }
  }
  
  server.close();
});
