import { parentPort, workerData } from 'node:worker_threads';
import { AgentToolbox, type AgentToolSnapshot } from '../core/agent-tools';

/** Node worker for agentic discovery tools (86a): user regexes and evaluations run here, terminable by the run. */
const toolbox = new AgentToolbox(workerData as AgentToolSnapshot);
parentPort!.on('message', ({ id, name, args }: { id: number; name: string; args: unknown }) => {
  const result = toolbox.call(name, args);
  parentPort!.postMessage({ id, result, ...(name === 'submit_proposal' && result.ok ? { proposal: toolbox.proposal } : {}) });
});
