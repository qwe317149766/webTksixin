const { makeLadon } = require('../ladon');

describe('Ladon Encryption', () => {
  test('should generate ladon signature', () => {
    const khronos = "1758533246";
    const aid = "31323333";
    
    const result = makeLadon(khronos, aid);
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

