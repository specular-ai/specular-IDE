// A small exploration fixture; the timer has not been implemented yet.
// Intent: REQ-001, REQ-002, REQ-003. State model: DD-001.
export type TimerState = 'idle' | 'running' | 'paused' | 'complete';

export interface Timer {
  state: TimerState;
  remainingSeconds: number;
}

export const initialTimer: Timer = {
  state: 'idle',
  remainingSeconds: 25 * 60,
};
