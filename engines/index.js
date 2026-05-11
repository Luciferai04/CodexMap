const codex = require('./codex');
const fake = require('./fake');
const { validateEngineAdapter } = require('./contract');

const engines = {
  codex: validateEngineAdapter('codex', codex),
  fake: validateEngineAdapter('fake', fake),
};

function getEngine(name = 'codex') {
  const engine = engines[name];
  if (!engine) {
    throw new Error(`Unknown engine "${name}". Available engines: ${Object.keys(engines).join(', ')}`);
  }
  return engine;
}

function listEngines() {
  return Object.keys(engines);
}

module.exports = {
  getEngine,
  listEngines,
};
