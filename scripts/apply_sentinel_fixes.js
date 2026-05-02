const fs = require('fs');

let sentinel = fs.readFileSync('agents/sentinel.js', 'utf8');

// Add p-limit require at the top
if (!sentinel.includes("require('p-limit')")) {
  sentinel = sentinel.replace(
    "const fs = require('fs');",
    "const fs = require('fs');\nconst pLimit = require('p-limit');\nconst limit = pLimit(3);"
  );
}

// Update chokidar watch loop
const oldChokidarLoop = `  for (const node of state.nodes) {
    if (node.type === 'directory') continue; // Handled by parent pass
    if (reanchorRegistry.has(node.id)) continue;
    if (isBeingHealed(node.id)) continue;
    
    const scoreKey = \`\${node.id}:\${node.contentHash}\`;
    if (node.grade !== 'pending' && scoredNodes.has(scoreKey)) continue;

    // We process synchronously for simple batching in this loop
    try {
      const result = await scoreNode(node, state, gradeMap, prompt);
      if (result) {
        node.score = result.score;
        node.grade = result.grade;
        node.scoring_breakdown = result.scoring_breakdown;
        if(result.summary) node.summary = result.summary;
        scoredNodes.add(scoreKey);
        gradeMap.set(node.id, node.grade);
        anyScored = true;

        if (autoHeal && result.score < 0.40 && !reanchorRegistry.has(node.id)) {
          reanchorNode(node.id, prompt);
        }
      }
    } catch (err) {
      console.error(\`[SENTINEL] ✖ Scoring error for \${node.id}: \${err.message}\`);
    }
  }`;

const newChokidarLoop = `  const needsScoring = state.nodes.filter(node => {
    if (node.type === 'directory') return false;
    if (reanchorRegistry.has(node.id)) return false;
    if (isBeingHealed(node.id)) return false;
    const scoreKey = \`\${node.id}:\${node.contentHash}\`;
    if (node.grade !== 'pending' && scoredNodes.has(scoreKey)) return false;
    return true;
  });

  const BATCH_SIZE = 10;
  for (let i = 0; i < needsScoring.length; i += BATCH_SIZE) {
    const batch = needsScoring.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(node => 
      limit(async () => {
        try {
          const result = await scoreNode(node, state, gradeMap, prompt);
          if (result) {
            node.score = result.score;
            node.grade = result.grade;
            node.scoring_breakdown = result.scoring_breakdown;
            if(result.summary) node.summary = result.summary;
            scoredNodes.add(\`\${node.id}:\${node.contentHash}\`);
            gradeMap.set(node.id, node.grade);
            anyScored = true;

            if (autoHeal && result.score < 0.40 && !reanchorRegistry.has(node.id)) {
              reanchorNode(node.id, prompt);
            }
          }
        } catch (err) {
          console.error(\`[SENTINEL] ✖ Scoring error for \${node.id}: \${err.message}\`);
        }
      })
    ));
    if (i + BATCH_SIZE < needsScoring.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }`;

if (sentinel.includes(oldChokidarLoop)) {
  sentinel = sentinel.replace(oldChokidarLoop, newChokidarLoop);
}

// Update triggerInitialPass loop
const oldInitialLoop = `    for (const node of pending) {
      if (node.type === 'directory') continue;
      if (isBeingHealed(node.id)) continue;
      const result = await scoreNode(node, state, gradeMap, prompt);
      if (result) {
        node.score = result.score;
        node.grade = result.grade;
        node.scoring_breakdown = result.scoring_breakdown;
        if(result.summary) node.summary = result.summary;
        scoredNodes.add(\`\${node.id}:\${node.contentHash}\`);
        gradeMap.set(node.id, node.grade);
        
        // Final write after each node (Task: Reliability)
        computeParentScores(state);
        atomicWriteJson(MAP_STATE_PATH, state);
      }
    }`;

const newInitialLoop = `    const BATCH_SIZE = 10;
    const needsScoring = pending.filter(node => node.type !== 'directory' && !isBeingHealed(node.id));
    for (let i = 0; i < needsScoring.length; i += BATCH_SIZE) {
      const batch = needsScoring.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(node => 
        limit(async () => {
          const result = await scoreNode(node, state, gradeMap, prompt);
          if (result) {
            node.score = result.score;
            node.grade = result.grade;
            node.scoring_breakdown = result.scoring_breakdown;
            if(result.summary) node.summary = result.summary;
            scoredNodes.add(\`\${node.id}:\${node.contentHash}\`);
            gradeMap.set(node.id, node.grade);
          }
        })
      ));
      computeParentScores(state);
      atomicWriteJson(MAP_STATE_PATH, state);
      if (i + BATCH_SIZE < needsScoring.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }`;

if (sentinel.includes(oldInitialLoop)) {
  sentinel = sentinel.replace(oldInitialLoop, newInitialLoop);
}

fs.writeFileSync('agents/sentinel.js', sentinel, 'utf8');
console.log('Applied sentinel.js rate limiting');
