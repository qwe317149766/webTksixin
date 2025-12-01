const { makeGorgon } = require('../gorgon');

describe('Gorgon Encryption', () => {
  test('should generate gorgon signature', () => {
    const khronos = "1751607382";
    const queryString = "device_platform=android&os=android";
    const xSsStub = "0000000000000000000000000000000";
    
    const result = makeGorgon(khronos, queryString, "4a0016a8476c0080", xSsStub);
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.startsWith('840480a80000')).toBe(true);
  });
});

