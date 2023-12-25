import { render } from 'ink'
import App from './App.tsx'

render(<App />, {
  debug: false,
  exitOnCtrlC: true,
})

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('true', () => {
    expect(0).toBe(0)
    expect(1).toBe(1)
    expect(6).toBe(6)
  })
}
