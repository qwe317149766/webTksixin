const { makeArgus } = require('../argus');

describe('Argus Encryption', () => {
  test('should generate argus signature', () => {
    const protobuf = "08d2a4808204100218e29b8eb706220431323333320a323134323834303535313a0634302e362e3342147630352e30322e30302d6f762d616e64726f696448c08090505208000000000000000060fceaa68c0d6a0632d478d616c37206758cb008f2d27a0a082a300238f4eaa68c0d8801fceaa68c0da201046e6f6e65a801f004ba011d0a07506978656c203610121a0a676f6f676c65706c617920808085c601c80102e0010ae80104f00108f8019aa4b8eb01880204";
    const p14_1 = "23";
    
    const result = makeArgus(protobuf, p14_1);
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

