import { useEffect, useState } from 'react'
import { Box, Text } from 'ink'

function App() {
  const [count, setCount] = useState(0)
  const messages = ['Hello', 'World', 'Foo', 'Bar']
  const currentMessage = messages[count % messages.length]

  useEffect(() => {
    const timer = setInterval(() => {
      setCount((count) => count + 1)
    }, 1000)

    return () => clearInterval(timer)
  })

  return (
    <Box margin={0} width="100%" flexDirection="column">
      <Box flexDirection="column">
        {[...messages]
          .slice(0, 3)
          .reverse()
          .map((item, index) => (
            <Box
              key={index}
              borderStyle="round"
              borderColor="green"
              padding={1}
              width="100%"
            >
              <Text color="white">{item}</Text>
            </Box>
          ))}
      </Box>

      <Box marginTop={1} flexDirection="row" gap={1}>
        <Text color="green">{'>'}</Text>
        <Text>{currentMessage}</Text>
      </Box>
    </Box>
  )
}

export default App

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('true', () => {
    expect(0).toBe(0)
    expect(1).toBe(1)
    expect(6).toBe(6)
  })
}
