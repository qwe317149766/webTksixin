const { makeArgus } = require('../argus');
const { makeGorgon } = require('../gorgon');
const { makeLadon } = require('../ladon');
const { execSync } = require('child_process');
const path = require('path');

/**
 * 调用 Python 加密函数
 */
function callPythonEncryption(command, ...args) {
  const scriptPath = path.join(__dirname, '../../../..', 'test_encryption_python.py');
  const argsStr = args.map(arg => `"${arg}"`).join(' ');
  const commandStr = `python "${scriptPath}" ${command} ${argsStr}`;
  
  try {
    const output = execSync(commandStr, { 
      encoding: 'utf8',
      cwd: path.join(__dirname, '../../../..')
    });
    const result = JSON.parse(output.trim());
    if (result.error) {
      throw new Error(result.error);
    }
    return result.result;
  } catch (error) {
    throw new Error(`Python execution failed: ${error.message}`);
  }
}

describe('Encryption Comparison: Node.js vs Python', () => {
  // 测试用例数据
  const testCases = {
    argus: {
      protobuf: "08d2a4808204100218e29b8eb706220431323333320a323134323834303535313a0634302e362e3342147630352e30322e30302d6f762d616e64726f696448c08090505208000000000000000060fceaa68c0d6a0632d478d616c37206758cb008f2d27a0a082a300238f4eaa68c0d8801fceaa68c0da201046e6f6e65a801f004ba011d0a07506978656c203610121a0a676f6f676c65706c617920808085c601c80102e0010ae80104f00108f8019aa4b8eb01880204",
      p14_1: "23",
      signKey: "wC8lD4bMTxmNVwY5jSkqi3QWmrphr/58ugLko7UZgWM="
    },
    gorgon: {
      khronos: "1751607382",
      queryString: "device_platform=android&os=android&ssmix=a&_rticket=1751607382364&channel=googleplay&aid=1180",
      key: "4a0016a8476c0080",
      xSsStub: "0000000000000000000000000000000"
    },
    ladon: {
      khronos: "1758533246",
      aid: "31323333"
    }
  };

  describe('Argus Encryption', () => {
    test('should generate valid argus signature (random numbers cause different outputs)', () => {
      const { protobuf, p14_1, signKey } = testCases.argus;
      
      // Node.js 加密
      const nodeResult = makeArgus(protobuf, p14_1, signKey);
      
      // Python 加密
      const pythonResult = callPythonEncryption('argus', protobuf, p14_1, signKey);
      
      console.log('Node.js Argus:', nodeResult);
      console.log('Python Argus:', pythonResult);
      
      // Argus 包含随机数，所以结果会不同，这是正常的
      // 我们只验证输出格式是否正确
      expect(nodeResult).toBeDefined();
      expect(typeof nodeResult).toBe('string');
      expect(nodeResult.length).toBeGreaterThan(0);
      // Base64 格式验证
      expect(/^[A-Za-z0-9+/=]+$/.test(nodeResult)).toBe(true);
      
      // Python 结果也应该有效
      expect(pythonResult).toBeDefined();
      expect(typeof pythonResult).toBe('string');
      expect(pythonResult.length).toBeGreaterThan(0);
    });
  });

  describe('Gorgon Encryption', () => {
    test('should match Python output', () => {
      const { khronos, queryString, key, xSsStub } = testCases.gorgon;
      
      // Node.js 加密
      const nodeResult = makeGorgon(khronos, queryString, key, xSsStub);
      
      // Python 加密
      const pythonResult = callPythonEncryption('gorgon', khronos, queryString, key, xSsStub);
      
      console.log('Node.js Gorgon:', nodeResult);
      console.log('Python Gorgon:', pythonResult);
      
      expect(nodeResult).toBe(pythonResult);
    });
  });

  describe('Ladon Encryption', () => {
    test('should generate valid ladon signature (random numbers cause different outputs)', () => {
      const { khronos, aid } = testCases.ladon;
      
      // Node.js 加密
      const nodeResult = makeLadon(khronos, aid);
      
      // Python 加密
      const pythonResult = callPythonEncryption('ladon', khronos, aid);
      
      console.log('Node.js Ladon:', nodeResult);
      console.log('Python Ladon:', pythonResult);
      
      // Ladon 包含随机数，所以结果会不同，这是正常的
      // 我们只验证输出格式是否正确
      expect(nodeResult).toBeDefined();
      expect(typeof nodeResult).toBe('string');
      expect(nodeResult.length).toBeGreaterThan(0);
      // Base64 格式验证
      expect(/^[A-Za-z0-9+/=]+$/.test(nodeResult)).toBe(true);
      
      // Python 结果也应该有效
      expect(pythonResult).toBeDefined();
      expect(typeof pythonResult).toBe('string');
      expect(pythonResult.length).toBeGreaterThan(0);
    });
  });

  describe('Multiple Random Tests', () => {
    test('should generate valid signatures for multiple inputs (random numbers cause different outputs)', () => {
      const testCount = 5;
      let allValid = true;
      const results = [];

      for (let i = 0; i < testCount; i++) {
        const khronos = Math.floor(Date.now() / 1000).toString();
        const aid = "31323333";
        
        try {
          const nodeResult = makeLadon(khronos, aid);
          const pythonResult = callPythonEncryption('ladon', khronos, aid);
          
          // 验证两个结果都是有效的 Base64 字符串
          const nodeValid = /^[A-Za-z0-9+/=]+$/.test(nodeResult) && nodeResult.length > 0;
          const pythonValid = /^[A-Za-z0-9+/=]+$/.test(pythonResult) && pythonResult.length > 0;
          
          if (!nodeValid || !pythonValid) {
            allValid = false;
            results.push({
              khronos,
              nodeValid,
              pythonValid,
              node: nodeResult,
              python: pythonResult
            });
          } else {
            results.push({
              khronos,
              nodeValid: true,
              pythonValid: true,
              note: 'Results differ due to random numbers (expected)'
            });
          }
        } catch (error) {
          console.error(`Test ${i + 1} failed:`, error.message);
          allValid = false;
          results.push({
            khronos: 'error',
            error: error.message
          });
        }
      }

      console.log('Test results:', JSON.stringify(results, null, 2));

      // 所有结果都应该是有效的格式
      expect(allValid).toBe(true);
    });
  });
});

