// ==UserScript==
// @name         咸鱼之王协议监控
// @namespace    https://github.com/xyzw-monitor
// @version      1.0.0
// @description  咸鱼之王游戏 WebSocket 协议抓包监控工具，支持解密、BON 解码、日志查看与消息发送
// @author       xyzw-monitor
// @match        *://xxz-xyzw.hortorgames.com/*
// @match        *://xxz-xyzw-res.hortorgames.com/h5web/*
// @match        *://*.hortorgames.com/*
// @grant        unsafeWindow
// @run-at       document-start
// @grant        fileSystem.write
// @grant        fileSystem.read
// ==/UserScript==

(function () {
  'use strict';

  // 获取真实的全局对象（AI之王等管理器环境下需要 unsafeWindow）
  const _global = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // 环境日志（仅开发调试用）
  console.log('[咸鱼之王监控] 脚本开始执行');

  // ============================================================
  // 协议层 - 二进制数据读写与编解码
  // ============================================================

  // --- DataReader：二进制数据读取器 ---
  // 移植自 Go 的 data_reader.go，提供从 Uint8Array 中按类型读取数据的能力

  class DataReader {
    /**
     * @param {Uint8Array} buffer - 要读取的二进制数据
     */
    constructor(buffer) {
      this.data = buffer;
      this.position = 0;
      // 创建 DataView 用于浮点数读取（小端序）
      this.dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    /**
     * 校验剩余数据是否足够读取指定大小
     * @param {number} size - 需要读取的字节数
     * @returns {boolean}
     */
    validate(size) {
      return this.position + size <= this.data.length;
    }

    /**
     * 读取无符号 8 位整数
     * @returns {number}
     */
    readUint8() {
      if (!this.validate(1)) throw new Error('read eof');
      return this.data[this.position++];
    }

    /**
     * 读取有符号 16 位整数（小端序）
     * @returns {number}
     */
    readInt16() {
      if (!this.validate(2)) throw new Error('read eof');
      const val = this.data[this.position] | (this.data[this.position + 1] << 8);
      this.position += 2;
      // 转为有符号 16 位
      return (val << 16) >> 16;
    }

    /**
     * 读取有符号 32 位整数（小端序）
     * @returns {number}
     */
    readInt32() {
      if (!this.validate(4)) throw new Error('read eof');
      const val = this.data[this.position]
        | (this.data[this.position + 1] << 8)
        | (this.data[this.position + 2] << 16)
        | (this.data[this.position + 3] << 24);
      this.position += 4;
      return val; // JavaScript 位运算自动产生有符号 32 位整数
    }

    /**
     * 读取 64 位整数（小端序，使用 Number 类型）
     * 与 Go 实现一致：先读低 32 位，若为负则加 4294967296，再加上高 32 位 * 4294967296
     * @returns {number}
     */
    readInt64() {
      const low = this.readInt32();
      const val64 = low < 0 ? low + 4294967296 : low;
      const high = this.readInt32();
      return val64 + 4294967296 * high;
    }

    /**
     * 读取 32 位浮点数（小端序，IEEE 754）
     * @returns {number}
     */
    readFloat32() {
      if (!this.validate(4)) throw new Error('read eof');
      const val = this.dataView.getFloat32(this.position, true); // true = 小端序
      this.position += 4;
      return val;
    }

    /**
     * 读取 64 位浮点数（小端序，IEEE 754）
     * @returns {number}
     */
    readFloat64() {
      if (!this.validate(8)) throw new Error('read eof');
      const val = this.dataView.getFloat64(this.position, true);
      this.position += 8;
      return val;
    }

    /**
     * 读取 7 位编码的变长整数
     * 每字节低 7 位为数据，最高位为继续标志
     * @returns {number}
     */
    read7BitInt() {
      let result = 0;
      let shift = 0;
      while (true) {
        if (shift >= 35) throw new Error('Format_Bad7BitInt32');
        const b = this.readUint8();
        result |= (b & 0x7F) << shift;
        shift += 7;
        if ((b & 0x80) === 0) break;
      }
      return result;
    }

    /**
     * 读取 UTF-8 字符串（7BitInt 长度前缀 + UTF-8 字节）
     * @returns {string}
     */
    readUTF() {
      const length = this.read7BitInt();
      return this.readUTFBytes(length);
    }

    /**
     * 读取指定长度的 UTF-8 字节并解码为字符串
     * @param {number} length - 字节长度
     * @returns {string}
     */
    readUTFBytes(length) {
      if (length === 0) return '';
      if (!this.validate(length)) throw new Error('read eof');
      const bytes = this.data.subarray(this.position, this.position + length);
      this.position += length;
      return new TextDecoder().decode(bytes);
    }

    /**
     * 读取指定长度的原始字节
     * @param {number} size - 字节数
     * @returns {Uint8Array}
     */
    readBytes(size) {
      if (!this.validate(size)) throw new Error('read eof');
      const result = this.data.slice(this.position, this.position + size);
      this.position += size;
      return result;
    }
  }

  // --- DataWriter：二进制数据写入器 ---
  // 移植自 Go 的 data_writer.go，提供按类型写入数据到缓冲区的能力

  class DataWriter {
    /**
     * 初始化写入器，预分配 512KB 缓冲区（与 Go 实现一致）
     */
    constructor() {
      const initialSize = 524288;
      this.data = new Uint8Array(initialSize);
      this.position = 0;
      // 创建 DataView 用于浮点数写入（小端序）
      this.dataView = new DataView(this.data.buffer);
    }

    /**
     * 确保缓冲区有足够空间，不足时按 1.2 倍扩容
     * @param {number} size - 需要的额外字节数
     */
    ensureBuffer(size) {
      if (this.position + size > this.data.length) {
        let newSize = Math.floor(this.data.length * 1.2);
        if (newSize < this.position + size) newSize = this.position + size;
        const newData = new Uint8Array(newSize);
        newData.set(this.data);
        this.data = newData;
        // 重建 DataView 指向新缓冲区
        this.dataView = new DataView(this.data.buffer);
      }
    }

    /**
     * 写入无符号 8 位整数
     * @param {number} val
     */
    writeUint8(val) {
      this.ensureBuffer(1);
      this.data[this.position] = val & 0xFF;
      this.position++;
    }

    /**
     * 写入有符号 16 位整数（小端序）
     * @param {number} val
     */
    writeInt16(val) {
      this.ensureBuffer(2);
      this.data[this.position] = val & 0xFF;
      this.data[this.position + 1] = (val >> 8) & 0xFF;
      this.position += 2;
    }

    /**
     * 写入有符号 32 位整数（小端序）
     * @param {number} val
     */
    writeInt32(val) {
      this.ensureBuffer(4);
      this.data[this.position] = val & 0xFF;
      this.data[this.position + 1] = (val >> 8) & 0xFF;
      this.data[this.position + 2] = (val >> 16) & 0xFF;
      this.data[this.position + 3] = (val >> 24) & 0xFF;
      this.position += 4;
    }

    /**
     * 写入 64 位整数（小端序，使用 Number 类型）
     * 与 Go 实现一致：先写低 32 位，再写高 32 位
     * @param {number} val
     */
    writeInt64(val) {
      // 写入低 32 位
      this.writeInt32(val | 0);
      // 写入高 32 位，与 Go 逻辑一致
      if (val < 0) {
        this.writeInt32(~Math.floor(val / 4294967296));
      } else {
        this.writeInt32(Math.floor(val / 4294967296));
      }
    }

    /**
     * 写入 32 位浮点数（小端序，IEEE 754）
     * @param {number} val
     */
    writeFloat32(val) {
      this.ensureBuffer(4);
      this.dataView.setFloat32(this.position, val, true); // true = 小端序
      this.position += 4;
    }

    /**
     * 写入 64 位浮点数（小端序，IEEE 754）
     * @param {number} val
     */
    writeFloat64(val) {
      this.ensureBuffer(8);
      this.dataView.setFloat64(this.position, val, true);
      this.position += 8;
    }

    /**
     * 写入 7 位编码的变长整数
     * 每字节低 7 位为数据，最高位为继续标志
     * @param {number} val
     */
    write7BitInt(val) {
      this.ensureBuffer(5); // 最多 5 字节
      while (val >= 128) {
        this.data[this.position] = (val | 0x80) & 0xFF;
        this.position++;
        val >>>= 7;
      }
      this.data[this.position] = val & 0xFF;
      this.position++;
    }

    /**
     * 写入 UTF-8 字符串（7BitInt 长度前缀 + UTF-8 字节）
     * @param {string} str
     */
    writeUTF(str) {
      if (!str || str.length === 0) {
        this.write7BitInt(0);
        return;
      }
      const encoded = new TextEncoder().encode(str);
      this.write7BitInt(encoded.length);
      this.ensureBuffer(encoded.length);
      this.data.set(encoded, this.position);
      this.position += encoded.length;
    }

    /**
     * 写入字节数组（支持偏移和长度参数）
     * @param {Uint8Array} data - 源数据
     * @param {number} [offset=0] - 起始偏移
     * @param {number} [length] - 写入长度，默认为剩余全部
     */
    writeBytes(data, offset = 0, length) {
      if (offset < 0) offset = 0;
      if (length === undefined) length = data.length - offset;
      if (length <= 0 || offset >= data.length) return;
      if (offset + length > data.length) length = data.length - offset;
      this.ensureBuffer(length);
      this.data.set(data.subarray(offset, offset + length), this.position);
      this.position += length;
    }

    /**
     * 获取已写入的数据
     * @param {boolean} [copy=true] - 是否返回副本
     * @returns {Uint8Array}
     */
    getBytes(copy = true) {
      if (copy) {
        return this.data.slice(0, this.position);
      }
      return this.data.subarray(0, this.position);
    }
  }

  // --- BonDecoder：BON 二进制解码器 ---
  // 移植自 Go 的 decoder.go，将 BON 格式二进制数据解码为 JavaScript 对象
  // 支持类型码：0=Null, 1=Int32, 2=Int64, 3=Float32, 4=Float64,
  //            5=String, 6=Boolean, 7=Binary, 8=Object, 9=Array,
  //            10=DateTime, 99=字符串引用

  class BonDecoder {
    constructor() {
      /** @type {DataReader|null} 当前数据读取器 */
      this.reader = null;
      /** @type {string[]} 字符串引用池，用于类型码 99 的字符串去重 */
      this.strArr = [];
    }

    /**
     * 解码 BON 二进制数据为 JavaScript 对象
     * @param {Uint8Array} data - BON 格式的二进制数据
     * @returns {any} 解码后的 JavaScript 值
     */
    decode(data) {
      this.reader = new DataReader(data);
      this.strArr = [];
      return this._decode();
    }

    /**
     * 内部递归解码方法，根据类型码分发到对应的解码逻辑
     * @returns {any}
     */
    _decode() {
      const typeCode = this.reader.readUint8();

      switch (typeCode) {
        case 0: // Null
          return null;

        case 1: // Int32 - 4字节小端序有符号整数
          return this.reader.readInt32();

        case 2: // Int64 - 8字节小端序整数
          return this.reader.readInt64();

        case 3: // Float32 - 4字节 IEEE 754 浮点数
          return this.reader.readFloat32();

        case 4: // Float64 - 8字节 IEEE 754 浮点数
          return this.reader.readFloat64();

        case 5: { // String - 7BitInt长度前缀 + UTF-8字节，存入引用池
          const str = this.reader.readUTF();
          this.strArr.push(str);
          return str;
        }

        case 6: { // Boolean - 1字节，0=false, 1=true
          const b = this.reader.readUint8();
          return b === 1;
        }

        case 7: { // Binary - 7BitInt长度前缀 + 原始字节数组
          const length = this.reader.read7BitInt();
          return this.reader.readBytes(length);
        }

        case 8: { // Object - 7BitInt键值对数量 + 递归解码键值对
          const count = this.reader.read7BitInt();
          const result = {};
          for (let i = 0; i < count; i++) {
            let key = this._decode();
            const value = this._decode();
            // 键必须为字符串，非字符串类型转换为字符串
            if (typeof key !== 'string') {
              key = String(key);
            }
            result[key] = value;
          }
          return result;
        }

        case 9: { // Array - 7BitInt长度 + 递归解码元素
          const length = this.reader.read7BitInt();
          const result = new Array(length);
          for (let i = 0; i < length; i++) {
            result[i] = this._decode();
          }
          return result;
        }

        case 10: { // DateTime - Int64 毫秒时间戳，返回 Date 对象
          const timestamp = this.reader.readInt64();
          return new Date(timestamp);
        }

        case 99: { // 字符串引用 - 7BitInt索引，从引用池获取
          const index = this.reader.read7BitInt();
          if (index < 0 || index >= this.strArr.length) {
            return '';
          }
          return this.strArr[index];
        }

        default: // 未知类型码返回 null
          return null;
      }
    }
  }

  // --- BonEncoder：BON 二进制编码器 ---
  // 移植自 Go 的 encoder.go，将 JavaScript 对象编码为 BON 格式二进制数据

  class BonEncoder {
    constructor() {
      /** @type {DataWriter} 数据写入器 */
      this.writer = null;
      /** @type {Map<string, number>} 字符串去重映射，值为首次出现的索引 */
      this.strMap = new Map();
    }

    /**
     * 将 JavaScript 值编码为 BON 二进制数据
     * @param {any} value - 要编码的 JavaScript 值
     * @returns {Uint8Array} BON 格式的二进制数据
     */
    encode(value) {
      this.writer = new DataWriter();
      this.strMap = new Map();
      this._encode(value);
      return this.writer.getBytes();
    }

    /**
     * 内部递归编码方法，根据值类型分发到对应的编码逻辑
     * @param {any} value - 要编码的值
     */
    _encode(value) {
      // null 或 undefined → 类型码 0
      if (value === null || value === undefined) {
        this.writer.writeUint8(0);
        return;
      }

      // Boolean → 类型码 6 + 1字节(0/1)
      if (typeof value === 'boolean') {
        this.writer.writeUint8(6);
        this.writer.writeUint8(value ? 1 : 0);
        return;
      }

      // Number → 整数用 Int32(类型码1)，浮点用 Float64(类型码4)
      if (typeof value === 'number') {
        if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
          // 安全整数范围内使用 Int32
          this.writer.writeUint8(1);
          this.writer.writeInt32(value);
        } else {
          // 超出 Int32 范围或浮点数使用 Float64
          this.writer.writeUint8(4);
          this.writer.writeFloat64(value);
        }
        return;
      }

      // String → 首次出现写类型码 5 + UTF，重复出现写类型码 99 + 索引
      if (typeof value === 'string') {
        if (this.strMap.has(value)) {
          // 字符串已出现过，写引用
          this.writer.writeUint8(99);
          this.writer.write7BitInt(this.strMap.get(value));
        } else {
          // 首次出现，写完整字符串并记录索引
          this.writer.writeUint8(5);
          this.writer.writeUTF(value);
          this.strMap.set(value, this.strMap.size);
        }
        return;
      }

      // Date → 类型码 10 + Int64 毫秒时间戳
      if (value instanceof Date) {
        this.writer.writeUint8(10);
        this.writer.writeInt64(value.getTime());
        return;
      }

      // Uint8Array → 类型码 7 + 7BitInt长度 + 字节数据
      if (value instanceof Uint8Array) {
        this.writer.writeUint8(7);
        this.writer.write7BitInt(value.length);
        this.writer.writeBytes(value);
        return;
      }

      // Array → 类型码 9 + 7BitInt长度 + 递归编码元素
      if (Array.isArray(value)) {
        this.writer.writeUint8(9);
        this.writer.write7BitInt(value.length);
        for (let i = 0; i < value.length; i++) {
          this._encode(value[i]);
        }
        return;
      }

      // Object → 类型码 8 + 7BitInt键值对数量 + 递归编码键值对
      if (typeof value === 'object') {
        const keys = Object.keys(value);
        this.writer.writeUint8(8);
        this.writer.write7BitInt(keys.length);
        for (const key of keys) {
          this._encode(key);
          this._encode(value[key]);
        }
        return;
      }

      // 其他未知类型按 null 处理
      this.writer.writeUint8(0);
    }
  }

  // --- Crypto：加密解密模块 ---
  // 移植自 Go 的 crypto.go，支持 X 加密/解密和 LX 解密
  // X 加密：前2字节 0x70 0x78（"px"），第3-4字节嵌入密钥，XOR 运算
  // LX 加密：前2字节 0x70 0x6C（"pl"），LZ4 压缩 + XOR 加密

  const Crypto = {
    /**
     * 检测加密类型
     * @param {Uint8Array} data - 原始二进制数据
     * @returns {'X' | 'LX' | 'NONE'} 加密类型
     */
    detectType(data) {
      if (!data || data.length < 2) return 'NONE';
      // 前2字节 0x70 0x78 ("px") → X 加密
      if (data[0] === 0x70 && data[1] === 0x78) return 'X';
      // 前2字节 0x70 0x6C ("pl") → LX 加密
      if (data[0] === 0x70 && data[1] === 0x6C) return 'LX';
      return 'NONE';
    },

    /**
     * 从第3-4字节提取8位密钥（与 Go 代码 DecryptX/DecryptLX 一致）
     * @param {Uint8Array} data - 至少4字节的数据
     * @returns {number} 8位密钥值
     */
    _extractKey(data) {
      return (
        ((data[2] >> 6 & 1) << 7) |
        ((data[2] >> 4 & 1) << 6) |
        ((data[2] >> 2 & 1) << 5) |
        ((data[2] >> 0 & 1) << 4) |
        ((data[3] >> 6 & 1) << 3) |
        ((data[3] >> 4 & 1) << 2) |
        ((data[3] >> 2 & 1) << 1) |
        ((data[3] >> 0 & 1) << 0)
      );
    },

    /**
     * X 解密：从头部提取密钥，XOR 解密，去除前4字节
     * 对应 Go 的 DecryptX
     * @param {Uint8Array} data - X 加密的数据
     * @returns {Uint8Array} 解密后的数据
     */
    decryptX(data) {
      if (!data || data.length < 4) {
        return data ? new Uint8Array(data) : new Uint8Array(0);
      }
      // 复制数据，避免修改原始数据
      const buf = new Uint8Array(data);
      const key = this._extractKey(buf);
      // 从后往前 XOR 解密（从最后一个字节到第5个字节）
      for (let i = buf.length - 1; i >= 4; i--) {
        buf[i] ^= key;
      }
      // 返回去除前4个字节的数据
      return buf.slice(4);
    },

    /**
     * X 加密：生成随机密钥，XOR 加密，添加头部
     * 对应 Go 的 EncryptX
     * @param {Uint8Array} data - 明文数据
     * @returns {Uint8Array} 加密后的数据
     */
    encryptX(data) {
      // 生成随机4字节头部
      const randomID = Math.floor(Math.random() * 0xFFFFFFFF);
      const result = new Uint8Array(data.length + 4);
      result[0] = randomID & 0xFF;
      result[1] = (randomID >> 8) & 0xFF;
      result[2] = (randomID >> 16) & 0xFF;
      result[3] = (randomID >> 24) & 0xFF;
      // 复制明文数据到第5字节开始的位置
      result.set(data, 4);

      // 生成随机密钥（2-249，与 Go 的 2 + rand.Intn(248) 一致）
      const key = 2 + Math.floor(Math.random() * 248);

      // 从后往前 XOR 加密（对所有字节）
      for (let i = result.length - 1; i >= 0; i--) {
        result[i] ^= key;
      }

      // 设置头部标识 "px" 并嵌入密钥
      result[0] = 0x70; // 'p'
      result[1] = 0x78; // 'x'
      // 将密钥位嵌入第3字节（保留 bit7,5,3,1 即 0xAA 掩码位）
      result[2] = (0xAA & result[2]) |
        ((key >> 7 & 1) << 6) |
        ((key >> 6 & 1) << 4) |
        ((key >> 5 & 1) << 2) |
        ((key >> 4 & 1) << 0);
      // 将密钥位嵌入第4字节（保留 bit7,5,3,1 即 0xAA 掩码位）
      result[3] = (0xAA & result[3]) |
        ((key >> 3 & 1) << 6) |
        ((key >> 2 & 1) << 4) |
        ((key >> 1 & 1) << 2) |
        ((key >> 0 & 1) << 0);

      return result;
    },

    /**
     * LX 解密：提取密钥，XOR 解密前100字节，还原 LZ4 头部，LZ4 解压
     * 对应 Go 的 DecryptLX
     * @param {Uint8Array} data - LX 加密的数据
     * @returns {Uint8Array} 解压后的数据
     */
    decryptLX(data) {
      if (!data || data.length < 4) {
        return data ? new Uint8Array(data) : new Uint8Array(0);
      }
      // 复制数据，避免修改原始数据
      const buf = new Uint8Array(data);
      const key = this._extractKey(buf);

      // 对前100个字节进行 XOR 解密（从第3字节开始，即索引2）
      const n = Math.min(buf.length, 100);
      for (let i = 2; i < n; i++) {
        buf[i] ^= key;
      }

      // 还原 LZ4 帧头部字节（LZ4 Frame Magic Number: 04 22 4D 18）
      buf[0] = 0x04;
      buf[1] = 0x22;
      buf[2] = 0x4D;
      buf[3] = 0x18;

      // LZ4 解压（使用 lz4js 库）
      if (typeof lz4 !== 'undefined' && lz4.decompress) {
        return lz4.decompress(buf);
      }
      // 测试环境中 LZ4 不可用时，返回还原头部后的数据
      console.warn('[Crypto] lz4 库不可用，无法解压 LX 数据');
      return buf;
    },

    /**
     * 统一解密入口，自动检测加密类型并调用对应方法
     * @param {Uint8Array} data - 原始加密数据
     * @returns {Uint8Array | null} 解密后的数据，失败返回 null
     */
    decrypt(data) {
      try {
        const type = this.detectType(data);
        switch (type) {
          case 'X':
            return this.decryptX(data);
          case 'LX':
            return this.decryptLX(data);
          case 'NONE':
            return data ? new Uint8Array(data) : null;
          default:
            return null;
        }
      } catch (e) {
        console.error('[Crypto] 解密失败:', e);
        return null;
      }
    }
  };

  // ============================================================
  // 数据层 - 消息解析、日志管理与配置
  // ============================================================

  // --- MessageParser：消息解析器 ---
  // 将解密解码后的原始对象解析为结构化消息（cmd、seq、ack、time、body）

  /**
   * 消息解析器
   * 使用 Crypto 解密 + BonDecoder 解码，将原始 WebSocket 数据解析为结构化消息
   * 维护 seq → timestamp 映射，用于计算请求-响应耗时
   */
  const MessageParser = {
    // seq → timestamp 映射，用于计算 send→receive 的耗时
    _seqTimestamps: new Map(),

    /**
     * 解析原始 WebSocket 数据为结构化消息对象
     * @param {Uint8Array} rawData - 原始加密数据
     * @param {'send' | 'receive'} direction - 消息方向
     * @returns {{ direction, cmd, seq, ack, time, body, rawSize, timestamp, duration } | null}
     */
    parse(rawData, direction) {
      try {
        const now = Date.now();
        const rawSize = rawData ? rawData.byteLength : 0;

        // 1. 解密
        const decrypted = Crypto.decrypt(rawData);
        if (!decrypted) {
          return null;
        }

        // 2. BON 解码为 JS 对象
        const decoder = new BonDecoder();
        const decoded = decoder.decode(decrypted);
        if (!decoded || typeof decoded !== 'object') {
          return null;
        }

        // 3. 提取 XYMsg 字段
        const cmd = decoded.cmd || '';
        const seq = decoded.seq || 0;
        const ack = decoded.ack || 0;
        const time = decoded.time || 0;
        let body = decoded.body;

        // 4. 如果 body 是 Uint8Array（二进制数据），进行二次 BON 解码
        if (body instanceof Uint8Array) {
          try {
            const bodyDecoder = new BonDecoder();
            body = bodyDecoder.decode(body);
          } catch (e) {
            // 二次解码失败，保留原始二进制数据
            console.warn('[MessageParser] body 二次 BON 解码失败:', e);
          }
        }

        // 5. 计算耗时（通过 seq/ack 配对）
        let duration = 0;
        if (direction === 'send' && seq > 0) {
          // 发送方向：记录 seq → timestamp
          this._seqTimestamps.set(seq, now);
        } else if (direction === 'receive' && ack > 0) {
          // 接收方向：如果 ack 匹配已记录的 seq，计算耗时
          const sendTime = this._seqTimestamps.get(ack);
          if (sendTime !== undefined) {
            duration = now - sendTime;
            // 配对完成，移除记录
            this._seqTimestamps.delete(ack);
          }
        }

        return {
          direction,
          cmd,
          seq,
          ack,
          time,
          body,
          rawSize,
          timestamp: now,
          duration
        };
      } catch (e) {
        console.error('[MessageParser] 解析失败:', e);
        return null;
      }
    }
  };

  // --- LogManager：日志管理器 ---
  // 管理消息日志列表，支持过滤、容量控制（最大 500 条）和自动淘汰

  // --- ProtocolAnalyzer：协议分析器 ---
  // 根据 cmd 命名规则和 body 字段特征，自动推断协议的业务含义
  // 优先使用用户备注（协议字典），没有则自动推断

  const ProtocolAnalyzer = {
    // === 协议模式学习：统计未识别 cmd 出现频率 ===
    _cmdStats: {},       // cmd → { count, lastSeen, firstSeen }
    _unrecognized: {},   // 未识别的 cmd → 出现次数

    // === 请求-响应关联分析：seq → 请求信息 ===
    _pendingRequests: {}, // seq → { cmd, body, timestamp }
    _pairHistory: [],     // 最近的配对记录 [{ reqCmd, reqBody, respCmd, respBody, duration }]
    _maxPairHistory: 100,

    // === 数值变化追踪：cmd → 上次 body 快照 ===
    _bodySnapshots: {},   // cmd → { body, timestamp }

    // === body 结构指纹：字段组合 → 业务含义 ===
    _fingerprints: [
      { fields: ['heroId', 'star', 'lv'], hint: '英雄详情/升级' },
      { fields: ['heroId', 'exp'], hint: '英雄经验变化' },
      { fields: ['heroList', 'formation'], hint: '阵容配置' },
      { fields: ['equipId', 'heroId'], hint: '装备穿戴/卸下' },
      { fields: ['stageId', 'star', 'reward'], hint: '关卡结算' },
      { fields: ['stageId', 'damage', 'hp'], hint: '战斗结果' },
      { fields: ['gold', 'diamond'], hint: '货币变化' },
      { fields: ['items', 'reward'], hint: '奖励领取' },
      { fields: ['mailId', 'title', 'content'], hint: '邮件详情' },
      { fields: ['mailId', 'reward'], hint: '邮件领取附件' },
      { fields: ['guildId', 'members'], hint: '公会成员信息' },
      { fields: ['rank', 'score', 'power'], hint: '排行榜数据' },
      { fields: ['skinId', 'heroId'], hint: '皮肤装配' },
      { fields: ['shopId', 'price', 'itemId'], hint: '商店购买' },
      { fields: ['energy', 'stamina'], hint: '体力/耐力状态' },
      { fields: ['chatMsg', 'channel', 'sender'], hint: '聊天消息' },
      { fields: ['token', 'expire'], hint: '令牌/会话信息' },
      { fields: ['config', 'version'], hint: '配置同步' },
      { fields: ['error', 'code', 'msg'], hint: '错误响应' },
      { fields: ['progress', 'total', 'current'], hint: '进度信息' },
    ],

    // cmd 模块名 → 中文模块名映射
    _modules: {
      'mail': '邮件', 'friend': '好友', 'club': '公会', 'arena': '竞技场',
      'discount': '折扣/活动', 'role': '角色', 'item': '物品', 'shop': '商店',
      'task': '任务', 'chat': '聊天', 'battle': '战斗', 'hero': '英雄',
      'equip': '装备', 'skill': '技能', 'sign': '签到', 'rank': '排行',
      'guild': '公会', 'pay': '支付', 'vip': 'VIP', 'activity': '活动',
      'system': '系统', 'login': '登录', 'user': '用户', 'player': '玩家',
      'bag': '背包', 'market': '市场', 'auction': '拍卖', 'trade': '交易',
      'dungeon': '副本', 'boss': 'Boss', 'pet': '宠物', 'mount': '坐骑',
      'title': '称号', 'achieve': '成就', 'welfare': '福利', 'redpacket': '红包',
      'racing': '竞速', 'nightmare': '噩梦', 'salt': '盐', 'push': '推送',
      'config': '配置', 'notice': '公告', 'announce': '公告', 'reward': '奖励',
      'daily': '每日', 'weekly': '每周', 'monthly': '月度', 'season': '赛季',
      'fish': '咸鱼', 'card': '卡牌', 'gacha': '抽卡', 'draw': '抽奖',
      'expedition': '远征', 'tower': '爬塔', 'mine': '矿场', 'farm': '农场',
      'blackmarket': '黑市', 'exchange': '兑换', 'compose': '合成',
      'offline': '离线', 'online': '在线', 'sync': '同步', 'heartbeat': '心跳',
      // 咸鱼之王特有模块（来源：咸鱼之王WIKI biligame）
      // — 图鉴系统
      'legacy': '传奇/挂机', 'hero': '咸将', 'general': '咸将',
      'xianjiang': '咸将', 'zhugong': '主公', 'yuling': '鱼灵',
      'toy': '玩具', 'prop': '道具', 'nightmare': '梦魇水晶',
      'atlas': '图鉴', 'collection': '图鉴积分',
      // — 副本系统
      'tower': '咸将塔', 'dream': '咸王梦境', 'lamp': '灯神挑战',
      'genie': '灯神挑战', 'godarena': '咸神竞技场',
      'dailytest': '每日咸王考验', 'exam': '咸王考验',
      // — 玩法系统
      'club': '俱乐部', 'recruit': '招募', 'chest': '宝箱',
      'box': '宝箱', 'blackmarket': '黑市', 'saltjar': '盐罐',
      'saltpot': '盐罐', 'master': '咸主', 'pvp': '对战房间',
      'room': '对战房间', 'cardgame': '咸鱼卡牌',
      'tentrial': '十殿试炼', 'tianguan': '天官赐福',
      'godring': '咸神擂台', 'rush': '咸鱼大冲关',
      // — 限时活动
      'weeklyrecruit': '招募达标', 'weeklychest': '宝箱达标',
      'weeklymarket': '江湖黑市', 'godfight': '咸神争霸',
      'monthcatch': '捕获达标', 'monthshell': '灵贝达标',
      // — 盐场/盐战系统
      'saltwar': '盐战', 'saltfield': '盐场', 'saltmine': '盐矿',
      'saltbattle': '盐场争霸', 'saltancestor': '盐祖',
      // — 其他系统
      'pushmap': '推图', 'stage': '关卡', 'chapter': '章节',
      'monthlyactivity': '月度活动', 'dailytask': '每日任务',
      'offlinetask': '离线任务', 'scriptdecrypt': '脚本解密',
      'hotupdate': '热更新', 'secondarypassword': '二级密码',
      'adminproxy': '管理代理', 'userproxy': '用户代理',
      'xyzwweb': '咸鱼Web', 'feedback': '反馈', 'settings': '设置',
      'account': '账号', 'business': '商业', 'utils': '工具',
      'skin': '皮肤', 'avatar': '头像', 'treasure': '宝藏',
      'world': '世界', 'map': '地图',
      'forge': '锻造/淬炼', 'quench': '淬炼', 'temper': '淬炼',
      'fishing': '钓鱼', 'fish': '咸鱼', 'goldfish': '金鱼',
      'speed': '速度', 'formation': '阵容', 'lineup': '站位',
      'alliance': '联盟', 'territory': '领地',
      'cross': '跨服', 'server': '服务器',
      'checkin': '签到', 'lottery': '抽奖', 'wheel': '转盘',
      'recharge': '充值', 'order': '订单', 'gift': '礼包',
      'event': '活动', 'festival': '节日', 'limit': '限时',
      'pass': '通行证', 'privilege': '特权', 'subscription': '订阅',
      'answer': '答题', 'quiz': '答题', 'question': '答题',
      'shell': '灵贝', 'pearl': '灵珠', 'bead': '珠子',
      'star': '星级', 'fragment': '碎片', 'shard': '碎片',
      'hangup': '挂机', 'idle': '挂机', 'afk': '挂机',
      'backhill': '后山', 'forbidden': '禁地',
      'moonpalace': '广寒宫', 'secret': '秘境',
    },

    // cmd 动作关键词 → 中文动作映射
    _actions: {
      'get': '获取', 'set': '设置', 'list': '列表', 'info': '信息',
      'update': '更新', 'delete': '删除', 'add': '添加', 'remove': '移除',
      'buy': '购买', 'sell': '出售', 'use': '使用', 'open': '打开',
      'close': '关闭', 'start': '开始', 'end': '结束', 'finish': '完成',
      'apply': '申请', 'accept': '接受', 'reject': '拒绝', 'cancel': '取消',
      'send': '发送', 'receive': '接收', 'read': '已读', 'claim': '领取',
      'enter': '进入', 'leave': '离开', 'join': '加入', 'quit': '退出',
      'upgrade': '升级', 'levelup': '升级', 'unlock': '解锁',
      'refresh': '刷新', 'reset': '重置', 'query': '查询', 'search': '搜索',
      'notify': '通知', 'push': '推送', 'new': '新建', 'create': '创建',
      'challenge': '挑战', 'fight': '战斗', 'attack': '攻击',
      'sweep': '扫荡', 'skip': '跳过', 'auto': '自动',
      // 咸鱼之王常见动作
      'hangup': '挂机收益', 'hang': '挂机', 'idle': '挂机',
      'check': '检查', 'init': '初始化', 'load': '加载', 'save': '保存',
      'login': '登录', 'logout': '登出', 'register': '注册',
      'invite': '邀请', 'kick': '踢出', 'dismiss': '解散',
      'donate': '捐献', 'contribute': '贡献', 'worship': '膜拜',
      'explore': '探索', 'adventure': '冒险', 'patrol': '巡逻',
      'collect': '收集', 'gather': '采集', 'harvest': '收获',
      'summon': '召唤', 'recruit': '招募', 'dismiss': '遣散',
      'enhance': '强化', 'evolve': '进化', 'awaken': '觉醒',
      'decompose': '分解', 'recycle': '回收', 'dismantle': '拆解',
      'equip': '穿戴', 'unequip': '卸下', 'wear': '穿戴',
      'forge': '锻造', 'craft': '制作', 'make': '制作',
      'enchant': '附魔', 'refine': '精炼', 'polish': '打磨',
      'batch': '批量', 'all': '全部', 'one': '单次',
      'share': '分享', 'like': '点赞', 'follow': '关注',
      'bind': '绑定', 'unbind': '解绑', 'verify': '验证',
      'redeem': '兑换', 'activate': '激活', 'deactivate': '停用',
      'pick': '选择', 'choose': '选择', 'select': '选择',
      'confirm': '确认', 'submit': '提交', 'complete': '完成',
      'reward': '奖励', 'bonus': '奖金', 'prize': '奖品',
      'rank': '排名', 'score': '积分', 'settle': '结算',
      'match': '匹配', 'ready': '准备', 'begin': '开始',
      'move': '移动', 'pass': '通过', 'clear': '通关',
      'revive': '复活', 'heal': '治疗', 'buff': '增益',
      'chat': '聊天', 'msg': '消息', 'message': '消息',
      'pay': '支付', 'purchase': '购买', 'consume': '消耗',
      'change': '更换', 'switch': '切换', 'toggle': '切换',
      'rename': '改名', 'modify': '修改', 'edit': '编辑',
    },

    // body 字段特征 → 业务含义提示
    _fieldHints: {
      'roleId': '角色ID', 'roleName': '角色名', 'level': '等级',
      'exp': '经验', 'gold': '金币', 'diamond': '钻石', 'coin': '货币',
      'list': '列表数据', 'count': '数量', 'total': '总数',
      'mailId': '邮件ID', 'title': '标题', 'content': '内容',
      'reward': '奖励', 'items': '物品列表', 'itemId': '物品ID',
      'price': '价格', 'cost': '消耗', 'num': '数量',
      'hp': '生命值', 'atk': '攻击力', 'def': '防御力',
      'score': '分数', 'rank': '排名', 'power': '战力',
      'time': '时间', 'expire': '过期时间', 'cd': '冷却时间',
      'status': '状态', 'state': '状态', 'type': '类型',
      'name': '名称', 'desc': '描述', 'icon': '图标',
      // 咸鱼之王常见字段
      'role': '角色数据', 'quantity': '数量', 'quality': '品质',
      'star': '星级', 'stars': '星级', 'lv': '等级', 'id': 'ID',
      'heroId': '英雄ID', 'heroList': '英雄列表', 'heroes': '英雄列表',
      'equipId': '装备ID', 'equipList': '装备列表',
      'skillId': '技能ID', 'skillList': '技能列表',
      'stageId': '关卡ID', 'chapterId': '章节ID', 'mapId': '地图ID',
      'damage': '伤害', 'heal': '治疗量', 'shield': '护盾',
      'win': '胜利', 'lose': '失败', 'draw': '平局', 'result': '结果',
      'energy': '体力', 'stamina': '耐力', 'ap': '行动力',
      'token': '令牌', 'ticket': '门票', 'key': '钥匙',
      'skinId': '皮肤ID', 'avatarId': '头像ID', 'frameId': '边框ID',
      'guildId': '公会ID', 'clubId': '俱乐部ID', 'teamId': '队伍ID',
      'chatMsg': '聊天消息', 'channel': '频道', 'sender': '发送者',
      'config': '配置数据', 'version': '版本', 'timestamp': '时间戳',
      'error': '错误', 'code': '状态码', 'msg': '消息',
      'data': '数据', 'info': '信息', 'detail': '详情',
      'progress': '进度', 'percent': '百分比', 'ratio': '比率',
      'max': '最大值', 'min': '最小值', 'cur': '当前值', 'current': '当前值',
      'buff': '增益效果', 'debuff': '减益效果', 'effect': '效果',
      'duration': '持续时间', 'cooldown': '冷却时间', 'interval': '间隔',
      'target': '目标', 'source': '来源', 'from': '来自', 'to': '发往',
    },

    /**
     * 分析协议，返回中文业务描述
     * @param {string} cmd - 命令名称
     * @param {object} body - 消息体
     * @param {string} direction - 'send' | 'receive'
     * @param {string|null} userNote - 用户备注
     * @param {string|null} dictNote - 字典库说明
     * @returns {string} 分析结果描述
     */
    analyze(cmd, body, direction, userNote, dictNote) {
      const parts = [];

      // 优先显示用户备注
      if (userNote) {
        parts.push(userNote);
      }

      // 其次显示字典库说明（与备注不重复时才显示）
      if (dictNote && dictNote !== userNote) {
        parts.push(dictNote);
      }

      // 自动推断模块+动作
      const autoDesc = this._inferFromCmd(cmd, direction);
      if (autoDesc) {
        parts.push(autoDesc);
      }

      // body 结构指纹识别
      const fingerprint = this._matchFingerprint(body);
      if (fingerprint) {
        parts.push('匹配: ' + fingerprint);
      }

      // body 字段分析
      const fieldDesc = this._inferFromBody(body);
      if (fieldDesc) {
        parts.push(fieldDesc);
      }

      return parts.join('\n') || '暂无分析';
    },

    /**
     * 从 cmd 名称推断协议含义
     * @param {string} cmd - 命令名称
     * @param {string} direction - 消息方向
     * @returns {string} 推断描述
     */
    _inferFromCmd(cmd, direction) {
      if (!cmd) return '';

      // 判断是请求还是响应
      const isResp = /resp$/i.test(cmd) || /response$/i.test(cmd);
      const isReq = /req$/i.test(cmd) || /request$/i.test(cmd);
      const isNotify = /notify$/i.test(cmd) || /push$/i.test(cmd);
      const dirLabel = isResp ? '响应' : isReq ? '请求' : isNotify ? '推送' :
        (direction === 'send' ? '请求' : '响应');

      // 去掉后缀，分割 cmd
      const cleaned = cmd.replace(/(Resp|Response|Req|Request|Notify)$/i, '');
      // 按 _ 分割，或按驼峰分割
      const segments = cleaned.split('_').filter(Boolean);

      let moduleName = '';
      let actionName = '';

      if (segments.length >= 2) {
        // 格式：Module_Action 或 Module_ActionDetail
        const moduleKey = segments[0].toLowerCase();
        moduleName = this._modules[moduleKey] || segments[0];
        // 剩余部分作为动作
        const actionPart = segments.slice(1).join('');
        actionName = this._matchAction(actionPart);
      } else if (segments.length === 1) {
        // 单段，尝试驼峰拆分
        const camelParts = segments[0].replace(/([a-z])([A-Z])/g, '$1_$2').split('_');
        if (camelParts.length >= 2) {
          const moduleKey = camelParts[0].toLowerCase();
          moduleName = this._modules[moduleKey] || camelParts[0];
          actionName = this._matchAction(camelParts.slice(1).join(''));
        } else {
          moduleName = segments[0];
        }
      }

      if (moduleName) {
        return moduleName + (actionName ? ' - ' + actionName : '') + '（' + dirLabel + '）';
      }
      return dirLabel;
    },

    /**
     * 从动作字符串中匹配已知动作关键词
     * @param {string} actionStr - 动作字符串
     * @returns {string} 匹配到的中文动作
     */
    _matchAction(actionStr) {
      if (!actionStr) return '';
      const lower = actionStr.toLowerCase();

      // 1. 完整匹配
      if (this._actions[lower]) return this._actions[lower];

      // 2. 驼峰拆分后逐段翻译（如 ClaimHangUp → ['Claim','Hang','Up']）
      const camelParts = actionStr.replace(/([a-z])([A-Z])/g, '$1_$2').split('_').filter(Boolean);
      if (camelParts.length >= 2) {
        const translated = [];
        let i = 0;
        while (i < camelParts.length) {
          let matched = false;
          // 尝试合并相邻词匹配（如 Hang+Up → hangup）
          if (i + 1 < camelParts.length) {
            const combined = (camelParts[i] + camelParts[i + 1]).toLowerCase();
            if (this._actions[combined]) {
              translated.push(this._actions[combined]);
              i += 2;
              matched = true;
            }
          }
          if (!matched) {
            const partLower = camelParts[i].toLowerCase();
            translated.push(this._actions[partLower] || camelParts[i]);
            i++;
          }
        }
        return translated.join('');
      }

      // 3. 前缀匹配
      for (const [key, label] of Object.entries(this._actions)) {
        if (lower.startsWith(key)) {
          const rest = actionStr.slice(key.length);
          if (rest) {
            // 递归翻译剩余部分
            const restTranslated = this._matchAction(rest);
            return label + restTranslated;
          }
          return label;
        }
      }
      return actionStr;
    },

    /**
     * 从 body 字段推断数据含义
     * @param {object} body - 消息体
     * @returns {string} 字段分析描述
     */
    _inferFromBody(body) {
      if (!body || typeof body !== 'object') return '';

      const hints = [];
      // 递归收集字段提示，最大深度2层
      this._collectFieldHints(body, hints, 0, 2);

      if (hints.length > 0) {
        return '包含: ' + hints.slice(0, 10).join(', ') + (hints.length > 10 ? '...' : '');
      }
      const keys = Object.keys(body);
      return '字段: ' + keys.slice(0, 6).join(', ') + (keys.length > 6 ? '...' : '');
    },

    /**
     * 递归收集字段提示
     * @param {object} obj - 要分析的对象
     * @param {string[]} hints - 收集到的提示数组
     * @param {number} depth - 当前深度
     * @param {number} maxDepth - 最大递归深度
     */
    _collectFieldHints(obj, hints, depth, maxDepth) {
      if (!obj || typeof obj !== 'object' || depth > maxDepth) return;

      const keys = Array.isArray(obj) ? [] : Object.keys(obj);

      // 数组：分析第一个元素
      if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
        this._collectFieldHints(obj[0], hints, depth + 1, maxDepth);
        return;
      }

      for (const key of keys.slice(0, 10)) {
        const lowerKey = key.toLowerCase();
        const val = obj[key];

        // 匹配已知字段
        let matched = false;
        for (const [fieldKey, hint] of Object.entries(this._fieldHints)) {
          if (lowerKey === fieldKey.toLowerCase()) {
            let valDesc = '';
            if (Array.isArray(val)) {
              valDesc = '(' + val.length + '条)';
            } else if (typeof val === 'number') {
              valDesc = '=' + val;
            } else if (typeof val === 'string' && val.length < 20) {
              valDesc = '="' + val + '"';
            }
            hints.push(hint + valDesc);
            matched = true;
            break;
          }
        }

        // 未匹配到的嵌套对象，递归分析
        if (!matched && val && typeof val === 'object' && depth < maxDepth) {
          this._collectFieldHints(val, hints, depth + 1, maxDepth);
        }
      }
    },

    /**
     * body 结构指纹匹配 — 根据字段组合推断业务含义
     * @param {object} body - 消息体
     * @returns {string|null} 匹配到的业务含义
     */
    _matchFingerprint(body) {
      if (!body || typeof body !== 'object') return null;
      const allKeys = new Set();
      const collectKeys = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 1) return;
        if (Array.isArray(obj)) {
          if (obj.length > 0 && typeof obj[0] === 'object') collectKeys(obj[0], depth + 1);
          return;
        }
        Object.keys(obj).forEach(k => {
          allKeys.add(k.toLowerCase());
          if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
            collectKeys(obj[k], depth + 1);
          }
        });
      };
      collectKeys(body, 0);

      let bestMatch = null;
      let bestLen = 0;
      for (const fp of this._fingerprints) {
        const matched = fp.fields.every(f => allKeys.has(f.toLowerCase()));
        if (matched && fp.fields.length > bestLen) {
          bestMatch = fp.hint;
          bestLen = fp.fields.length;
        }
      }
      return bestMatch;
    },

    /**
     * 数值变化追踪 — 对比同 cmd 上次 body 中的数值字段变化
     * @param {string} cmd - 命令名称
     * @param {object} body - 当前消息体
     * @returns {string|null} 变化描述
     */
    _trackValueChanges(cmd, body) {
      if (!cmd || !body || typeof body !== 'object') return null;

      const prev = this._bodySnapshots[cmd];
      // 保存当前快照
      try {
        this._bodySnapshots[cmd] = { body: JSON.parse(JSON.stringify(body)), timestamp: Date.now() };
      } catch (e) {
        return null;
      }

      if (!prev || !prev.body) return null;

      const changes = [];
      this._compareValues(prev.body, body, '', changes, 0);

      if (changes.length === 0) return null;
      return '数值变化: ' + changes.slice(0, 8).join(', ') + (changes.length > 8 ? '...' : '');
    },

    /**
     * 递归对比两个对象中的数值字段变化
     */
    _compareValues(oldObj, newObj, prefix, changes, depth) {
      if (depth > 2 || !oldObj || !newObj) return;
      if (typeof oldObj !== 'object' || typeof newObj !== 'object') return;

      const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
      for (const key of keys) {
        const oldVal = oldObj[key];
        const newVal = newObj[key];
        const hint = this._fieldHints[key] || key;

        if (typeof oldVal === 'number' && typeof newVal === 'number' && oldVal !== newVal) {
          const diff = newVal - oldVal;
          const sign = diff > 0 ? '+' : '';
          changes.push(hint + ' ' + oldVal + '→' + newVal + '(' + sign + diff + ')');
        } else if (typeof oldVal === 'object' && typeof newVal === 'object' &&
                   !Array.isArray(oldVal) && !Array.isArray(newVal)) {
          this._compareValues(oldVal, newVal, prefix ? prefix + '.' + key : key, changes, depth + 1);
        }
      }
    },

    /**
     * 记录 cmd 出现统计，标记未识别的 cmd
     * @param {string} cmd - 命令名称
     * @param {string} autoDesc - 自动推断结果
     */
    _recordCmdStats(cmd, autoDesc) {
      if (!cmd) return;
      const now = Date.now();
      if (!this._cmdStats[cmd]) {
        this._cmdStats[cmd] = { count: 0, firstSeen: now, lastSeen: now };
      }
      this._cmdStats[cmd].count++;
      this._cmdStats[cmd].lastSeen = now;

      // 如果自动推断结果只有方向标签，视为未识别
      const isRecognized = autoDesc && autoDesc !== '请求' && autoDesc !== '响应';
      if (!isRecognized) {
        this._unrecognized[cmd] = (this._unrecognized[cmd] || 0) + 1;
      }
    },

    /**
     * 获取按模块分组的 cmd 统计
     * @returns {Object<string, Array<{cmd: string, count: number}>>}
     */
    getCmdsByModule() {
      const groups = {};
      for (const [cmd, stats] of Object.entries(this._cmdStats)) {
        const moduleName = this._getModuleName(cmd);
        if (!groups[moduleName]) groups[moduleName] = [];
        groups[moduleName].push({ cmd, count: stats.count, lastSeen: stats.lastSeen });
      }
      for (const key of Object.keys(groups)) {
        groups[key].sort((a, b) => b.count - a.count);
      }
      return groups;
    },

    /**
     * 从 cmd 提取模块名（中文）
     */
    _getModuleName(cmd) {
      if (!cmd) return '未知';
      const cleaned = cmd.replace(/(Resp|Response|Req|Request|Notify)$/i, '');
      const segments = cleaned.split('_').filter(Boolean);
      if (segments.length >= 2) {
        const moduleKey = segments[0].toLowerCase();
        return this._modules[moduleKey] || segments[0];
      }
      const camelParts = cleaned.replace(/([a-z])([A-Z])/g, '$1_$2').split('_');
      if (camelParts.length >= 2) {
        const moduleKey = camelParts[0].toLowerCase();
        return this._modules[moduleKey] || camelParts[0];
      }
      return cleaned;
    },

    /**
     * 记录协议条目，用于请求-响应关联分析
     * 发送方向记录 pending，接收方向尝试配对
     * @param {object} entry - 日志条目 { direction, cmd, seq, ack, body, timestamp }
     */
    recordEntry(entry) {
      if (!entry || !entry.cmd) return;

      if (entry.direction === 'send' && entry.seq > 0) {
        // 记录发送请求，等待响应配对
        this._pendingRequests[entry.seq] = {
          cmd: entry.cmd,
          body: entry.body,
          timestamp: entry.timestamp || Date.now()
        };
      } else if (entry.direction === 'receive' && entry.ack > 0) {
        // 尝试与发送请求配对
        const req = this._pendingRequests[entry.ack];
        if (req) {
          const pair = {
            reqCmd: req.cmd,
            reqBody: req.body,
            respCmd: entry.cmd,
            respBody: entry.body,
            duration: (entry.timestamp || Date.now()) - req.timestamp
          };
          this._pairHistory.push(pair);
          // 保持历史记录在限制范围内
          if (this._pairHistory.length > this._maxPairHistory) {
            this._pairHistory.shift();
          }
          delete this._pendingRequests[entry.ack];
        }
      }
    },

    /**
     * 获取未识别的 cmd 列表（按出现次数降序）
     * @returns {Array<{cmd: string, count: number}>}
     */
    getUnrecognizedCmds() {
      return Object.entries(this._unrecognized)
        .map(([cmd, count]) => ({ cmd, count }))
        .sort((a, b) => b.count - a.count);
    },

    /**
     * 获取 cmd 统计数据
     * @returns {Object} _cmdStats 的副本
     */
    getCmdStats() {
      return { ...this._cmdStats };
    },

    /**
     * 获取请求-响应配对历史
     * @returns {Array} 配对记录数组
     */
    getPairHistory() {
      return this._pairHistory.slice();
    },

    /**
     * 获取请求-响应关联分析（指定 cmd 的平均耗时等）
     * @param {string} cmd - 要分析的 cmd 名称
     * @returns {{ avgDuration: number, count: number, pairs: Array }}
     */
    getCorrelation(cmd) {
      const pairs = this._pairHistory.filter(
        p => p.reqCmd === cmd || p.respCmd === cmd
      );
      if (pairs.length === 0) return { avgDuration: 0, count: 0, pairs: [] };
      const totalDuration = pairs.reduce((sum, p) => sum + (p.duration || 0), 0);
      return {
        avgDuration: Math.round(totalDuration / pairs.length),
        count: pairs.length,
        pairs
      };
    },

    /**
     * 导出分析器积累的字典数据（cmd → 自动推断描述）
     * @returns {Object<string, string>}
     */
    exportDictionary() {
      const dict = {};
      for (const [cmd, stats] of Object.entries(this._cmdStats)) {
        // 用 analyze 方法获取自动推断描述
        const desc = this.analyze(cmd, null, 'send', null, null);
        if (desc && desc !== '请求' && desc !== '响应') {
          dict[cmd] = desc;
        }
      }
      return dict;
    }
  };

  // --- DictionaryParser：字典文件解析器 ---
  // 支持解析 JSON、TXT、JS 格式的协议字典文件
  // 统一输出格式：{ cmd: '说明', ... }

  const DictionaryParser = {
    /**
     * 根据文件扩展名和内容自动解析字典
     * @param {string} fileName - 文件名（用于判断格式）
     * @param {string} content - 文件文本内容
     * @returns {{ entries: Object<string, string>, error: string|null }}
     */
    parse(fileName, content) {
      if (!content || !content.trim()) {
        return { entries: {}, error: '文件内容为空' };
      }

      const ext = (fileName || '').split('.').pop().toLowerCase();

      try {
        if (ext === 'json') {
          return this._parseJson(content);
        } else if (ext === 'txt') {
          return this._parseTxt(content);
        } else if (ext === 'js') {
          return this._parseJs(content);
        }
        // 未知扩展名，尝试自动检测格式
        return this._autoDetect(content);
      } catch (e) {
        return { entries: {}, error: '解析失败: ' + e.message };
      }
    },

    /**
     * 解析 JSON 格式字典
     * 支持两种格式：
     * 1. 对象格式：{ "cmd名": "说明", ... }
     * 2. 数组格式：[{ "cmd": "xxx", "note": "yyy" }, ...]
     */
    _parseJson(content) {
      const data = JSON.parse(content);

      // 格式1：直接的 { cmd: note } 对象
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const entries = {};
        for (const [key, val] of Object.entries(data)) {
          if (typeof val === 'string' && val.trim()) {
            entries[key] = val.trim();
          }
        }
        return { entries, error: null };
      }

      // 格式2：数组 [{ cmd, note/desc/description/name }]
      if (Array.isArray(data)) {
        const entries = {};
        for (const item of data) {
          if (!item || typeof item !== 'object') continue;
          const cmd = item.cmd || item.command || item.key || item.name;
          const note = item.note || item.desc || item.description || item.value || item.label;
          if (cmd && note && typeof cmd === 'string' && typeof note === 'string') {
            entries[cmd] = note.trim();
          }
        }
        return { entries, error: null };
      }

      return { entries: {}, error: 'JSON 格式不支持，需要对象或数组' };
    },

    /**
     * 解析 TXT 格式字典
     * 每行一条，支持分隔符：= | : | Tab | 连续空格
     * 忽略空行和 # 开头的注释行
     */
    _parseTxt(content) {
      const entries = {};
      const lines = content.split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();
        // 跳过空行和注释
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

        // 尝试多种分隔符
        let cmd = '', note = '';
        const separators = ['=', ':', '\t'];
        let matched = false;

        for (const sep of separators) {
          const idx = trimmed.indexOf(sep);
          if (idx > 0) {
            cmd = trimmed.substring(0, idx).trim();
            note = trimmed.substring(idx + 1).trim();
            if (cmd && note) {
              matched = true;
              break;
            }
          }
        }

        // 回退：用连续空格分割（至少2个空格）
        if (!matched) {
          const spaceMatch = trimmed.match(/^(\S+)\s{2,}(.+)$/);
          if (spaceMatch) {
            cmd = spaceMatch[1].trim();
            note = spaceMatch[2].trim();
            matched = true;
          }
        }

        if (matched && cmd && note) {
          entries[cmd] = note;
        }
      }

      return { entries, error: null };
    },

    /**
     * 解析 JS 格式字典
     * 支持格式：
     * 1. module.exports = { cmd: '说明', ... }
     * 2. export default { cmd: '说明', ... }
     * 3. const/var/let xxx = { cmd: '说明', ... }
     * 4. 纯对象字面量 { cmd: '说明', ... }
     * 提取其中的对象字面量部分，按 JSON 解析
     */
    _parseJs(content) {
      // 去掉 export/module.exports 等前缀，提取对象部分
      let cleaned = content.trim();
      // 移除 module.exports = / export default / const xxx =
      cleaned = cleaned.replace(/^(?:module\.exports\s*=|export\s+default|(?:const|let|var)\s+\w+\s*=)\s*/i, '');
      // 移除末尾分号
      cleaned = cleaned.replace(/;\s*$/, '');

      // 尝试直接 JSON 解析
      try {
        const data = JSON.parse(cleaned);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const entries = {};
          for (const [key, val] of Object.entries(data)) {
            if (typeof val === 'string' && val.trim()) {
              entries[key] = val.trim();
            }
          }
          return { entries, error: null };
        }
      } catch (e) {
        // JSON 解析失败，尝试提取键值对
      }

      // 回退：用正则提取 'key': 'value' 或 "key": "value" 模式
      const entries = {};
      const regex = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        entries[match[1]] = match[2];
      }

      if (Object.keys(entries).length > 0) {
        return { entries, error: null };
      }

      return { entries: {}, error: 'JS 文件中未找到有效的字典数据' };
    },

    /**
     * 自动检测内容格式并解析
     */
    _autoDetect(content) {
      const trimmed = content.trim();
      // 以 { 或 [ 开头，尝试 JSON
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return this._parseJson(trimmed);
      }
      // 包含 module.exports 或 export，尝试 JS
      if (trimmed.includes('module.exports') || trimmed.includes('export ')) {
        return this._parseJs(trimmed);
      }
      // 默认按 TXT 解析
      return this._parseTxt(trimmed);
    }
  };

  /**
   * 日志管理器
   * 管理消息日志列表，支持容量控制和黑名单过滤
   */
  class LogManager {
    /**
     * @param {number} maxSize - 最大日志条数，超过自动淘汰最早的
     */
    constructor(maxSize = 500) {
      this._logs = [];
      this._maxSize = maxSize;
      this._nextId = 1; // 自增 ID
    }

    /**
     * 添加日志条目
     * 超过 maxSize 时自动移除最早的条目
     * @param {object} message - MessageParser.parse() 返回的消息对象
     */
    add(message) {
      const entry = {
        id: this._nextId++,
        ...message
      };
      this._logs.push(entry);
      // 超过最大容量，移除最早的条目
      while (this._logs.length > this._maxSize) {
        this._logs.shift();
      }
    }

    /**
     * 获取过滤后的日志列表（排除黑名单中的 cmd）
     * @param {string[]} blacklist - 黑名单命令列表
     * @returns {object[]} 过滤后的日志数组
     */
    getFiltered(blacklist) {
      if (!blacklist || blacklist.length === 0) {
        return this._logs.slice();
      }
      const blackSet = new Set(blacklist);
      return this._logs.filter(entry => !blackSet.has(entry.cmd));
    }

    /**
     * 清空所有日志
     */
    clear() {
      this._logs = [];
    }

    /**
     * 获取总消息计数（包含已淘汰的）
     * @returns {number} 已处理的消息总数（即 nextId - 1）
     */
    getCount() {
      return this._nextId - 1;
    }
  }

  // --- ConfigManager：配置管理器 ---
  // 使用 localStorage 持久化黑名单等配置数据

  /**
   * 配置管理器
   * 使用 localStorage 持久化黑名单配置
   * 构造时自动从 localStorage 恢复配置
   */
  class ConfigManager {
    /**
     * @param {string} storageKey - localStorage 存储键名
     */
    constructor(storageKey = 'xyzw_monitor_config') {
      this._storageKey = storageKey;
      this._blacklist = [];
      /** @type {Object<string, string>} cmd → 备注文本 */
      this._notes = {};
      /** @type {Object<string, string>} cmd → 字典说明（独立于备注，支持导入导出） */
      this._dictionary = {};
      // 构造时自动加载已保存的配置
      this.load();
    }

    /**
     * 获取黑名单列表（返回副本，防止外部直接修改）
     * @returns {string[]} 黑名单命令列表
     */
    getBlacklist() {
      return this._blacklist.slice();
    }

    /**
     * 添加黑名单项，添加后自动持久化
     * @param {string} cmd - 要屏蔽的命令名称
     */
    addToBlacklist(cmd) {
      if (!cmd || this._blacklist.includes(cmd)) {
        return;
      }
      this._blacklist.push(cmd);
      this.save();
    }

    /**
     * 移除黑名单项，移除后自动持久化
     * @param {string} cmd - 要取消屏蔽的命令名称
     */
    removeFromBlacklist(cmd) {
      const index = this._blacklist.indexOf(cmd);
      if (index === -1) {
        return;
      }
      this._blacklist.splice(index, 1);
      this.save();
    }

    /**
     * 设置协议备注，自动持久化到 localStorage
     * @param {string} cmd - 命令名称
     * @param {string} note - 备注文本
     */
    setNote(cmd, note) {
      if (!cmd) return;
      if (!note || note.trim() === '') {
        // 空备注等同于删除
        this.removeNote(cmd);
        return;
      }
      this._notes[cmd] = note.trim();
      this.save();
    }

    /**
     * 获取指定命令的备注
     * @param {string} cmd - 命令名称
     * @returns {string|null} 备注文本，无备注返回 null
     */
    getNote(cmd) {
      return this._notes[cmd] || null;
    }

    /**
     * 删除指定命令的备注，自动持久化
     * @param {string} cmd - 命令名称
     */
    removeNote(cmd) {
      if (!cmd || !(cmd in this._notes)) return;
      delete this._notes[cmd];
      this.save();
    }

    /**
     * 获取所有备注（返回副本）
     * @returns {Object<string, string>} cmd → 备注文本
     */
    getAllNotes() {
      return Object.assign({}, this._notes);
    }

    /**
     * 获取有备注的命令列表
     * @returns {string[]} 有备注的 cmd 数组
     */
    getNotedCmds() {
      return Object.keys(this._notes);
    }

    // ========================================
    // 字典管理（支持导入/导出/备注同步）
    // ========================================

    /**
     * 获取字典中指定 cmd 的说明
     * @param {string} cmd - 命令名称
     * @returns {string|null} 字典说明
     */
    getDictEntry(cmd) {
      return this._dictionary[cmd] || null;
    }

    /**
     * 获取完整字典（返回副本）
     * @returns {Object<string, string>} cmd → 说明
     */
    getDictionary() {
      return Object.assign({}, this._dictionary);
    }

    /**
     * 获取字典条目数量
     * @returns {number}
     */
    getDictSize() {
      return Object.keys(this._dictionary).length;
    }

    /**
     * 批量导入字典条目（合并模式，已有条目可选覆盖）
     * @param {Object<string, string>} entries - cmd → 说明
     * @param {boolean} overwrite - 是否覆盖已有条目
     * @returns {{ added: number, updated: number, skipped: number }}
     */
    importDictionary(entries, overwrite = false) {
      let added = 0, updated = 0, skipped = 0;
      for (const [cmd, note] of Object.entries(entries)) {
        if (!cmd || typeof note !== 'string' || !note.trim()) continue;
        if (this._dictionary[cmd]) {
          if (overwrite) {
            this._dictionary[cmd] = note.trim();
            updated++;
          } else {
            skipped++;
          }
        } else {
          this._dictionary[cmd] = note.trim();
          added++;
        }
      }
      this.save();
      return { added, updated, skipped };
    }

    /**
     * 将所有用户备注同步到字典库（备注优先，不覆盖已有字典条目）
     * @param {boolean} overwrite - 是否用备注覆盖已有字典条目
     * @returns {{ added: number, updated: number }}
     */
    syncNotesToDictionary(overwrite = false) {
      let added = 0, updated = 0;
      for (const [cmd, note] of Object.entries(this._notes)) {
        if (!note) continue;
        if (this._dictionary[cmd]) {
          if (overwrite) {
            this._dictionary[cmd] = note;
            updated++;
          }
        } else {
          this._dictionary[cmd] = note;
          added++;
        }
      }
      this.save();
      return { added, updated };
    }

    /**
     * 删除字典中的指定条目
     * @param {string} cmd - 命令名称
     */
    removeDictEntry(cmd) {
      if (!cmd || !(cmd in this._dictionary)) return;
      delete this._dictionary[cmd];
      this.save();
    }

    /**
     * 清空整个字典
     */
    clearDictionary() {
      this._dictionary = {};
      this.save();
    }

    /**
     * 导出字典为 JSON 字符串
     * @returns {string} JSON 格式的字典数据
     */
    exportDictionaryJson() {
      return JSON.stringify(this._dictionary, null, 2);
    }

    // ========================================
    // 完整配置导出/导入（黑名单 + 备注 + 字典）
    // ========================================

    /**
     * 导出完整配置为 JSON 字符串
     * 包含黑名单、备注、字典三部分数据
     * @returns {string} JSON 格式的完整配置
     */
    exportConfigJson() {
      const config = {
        version: '1.0',
        exportTime: new Date().toISOString(),
        blacklist: this._blacklist,
        notes: this._notes,
        dictionary: this._dictionary
      };
      return JSON.stringify(config, null, 2);
    }

    /**
     * 从 JSON 数据导入完整配置（合并模式）
     * @param {string} jsonStr - JSON 格式的配置数据
     * @param {boolean} overwrite - 是否覆盖已有条目
     * @returns {{ blacklistAdded: number, notesAdded: number, notesUpdated: number, dictAdded: number, dictUpdated: number, error: string|null }}
     */
    importConfig(jsonStr, overwrite = false) {
      try {
        const config = JSON.parse(jsonStr);
        let blacklistAdded = 0, notesAdded = 0, notesUpdated = 0, dictAdded = 0, dictUpdated = 0;

        // 导入黑名单（合并，不重复添加）
        if (Array.isArray(config.blacklist)) {
          for (const cmd of config.blacklist) {
            if (typeof cmd === 'string' && cmd.trim() && !this._blacklist.includes(cmd)) {
              this._blacklist.push(cmd);
              blacklistAdded++;
            }
          }
        }

        // 导入备注
        if (config.notes && typeof config.notes === 'object' && !Array.isArray(config.notes)) {
          for (const [cmd, note] of Object.entries(config.notes)) {
            if (!cmd || typeof note !== 'string' || !note.trim()) continue;
            if (this._notes[cmd]) {
              if (overwrite) { this._notes[cmd] = note.trim(); notesUpdated++; }
            } else {
              this._notes[cmd] = note.trim(); notesAdded++;
            }
          }
        }

        // 导入字典
        if (config.dictionary && typeof config.dictionary === 'object' && !Array.isArray(config.dictionary)) {
          for (const [cmd, desc] of Object.entries(config.dictionary)) {
            if (!cmd || typeof desc !== 'string' || !desc.trim()) continue;
            if (this._dictionary[cmd]) {
              if (overwrite) { this._dictionary[cmd] = desc.trim(); dictUpdated++; }
            } else {
              this._dictionary[cmd] = desc.trim(); dictAdded++;
            }
          }
        }

        this.save();
        return { blacklistAdded, notesAdded, notesUpdated, dictAdded, dictUpdated, error: null };
      } catch (e) {
        return { blacklistAdded: 0, notesAdded: 0, notesUpdated: 0, dictAdded: 0, dictUpdated: 0, error: '配置解析失败: ' + e.message };
      }
    }

    /**
     * 保存配置到 localStorage
     */
    save() {
      try {
        const config = {
          blacklist: this._blacklist,
          notes: this._notes,
          dictionary: this._dictionary
        };
        localStorage.setItem(this._storageKey, JSON.stringify(config));
      } catch (e) {
        console.error('[ConfigManager] 保存配置失败:', e);
      }
    }

    /**
     * 从 localStorage 加载配置
     */
    load() {
      try {
        const raw = localStorage.getItem(this._storageKey);
        if (raw) {
          const config = JSON.parse(raw);
          if (Array.isArray(config.blacklist)) {
            this._blacklist = config.blacklist;
          }
          if (config.notes && typeof config.notes === 'object' && !Array.isArray(config.notes)) {
            this._notes = config.notes;
          }
          if (config.dictionary && typeof config.dictionary === 'object' && !Array.isArray(config.dictionary)) {
            this._dictionary = config.dictionary;
          }
        }
      } catch (e) {
        console.error('[ConfigManager] 加载配置失败:', e);
        this._blacklist = [];
        this._notes = {};
        this._dictionary = {};
      }
    }
  }

  // --- MessageSender：消息发送器 ---
  // 构造 XYMsg 结构，BON 编码后通过 X 加密发送

  class MessageSender {
    /**
     * @param {function(): WebSocket|null} getWebSocket - 获取当前活跃 WebSocket 连接的函数
     */
    constructor(getWebSocket) {
      /** @type {function(): WebSocket|null} */
      this._getWebSocket = getWebSocket;
      /** @type {number} 自增序列号 */
      this._seq = 0;
    }

    /**
     * 构造 XYMsg 并通过 WebSocket 发送
     * 流程：body BON编码 → 构造 XYMsg → 整体 BON编码 → X加密 → WebSocket发送
     * @param {string} cmd - 命令名称
     * @param {object} body - 消息体对象
     * @returns {boolean} 是否发送成功
     */
    send(cmd, body) {
      try {
        // 检查 WebSocket 连接是否可用
        const ws = this._getWebSocket();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.warn('[MessageSender] WebSocket 连接不可用');
          return false;
        }

        // 1. 用 BonEncoder 将 body 编码为二进制
        const bodyEncoder = new BonEncoder();
        const bodyBytes = bodyEncoder.encode(body);

        // 2. 构造 XYMsg 结构
        this._seq++;
        const xyMsg = {
          cmd: cmd,
          seq: this._seq,
          ack: 0,
          time: Date.now(),
          body: bodyBytes
        };

        // 3. 用 BonEncoder 将整个 XYMsg 编码为二进制
        const msgEncoder = new BonEncoder();
        const msgBytes = msgEncoder.encode(xyMsg);

        // 4. 用 X 加密
        const encrypted = Crypto.encryptX(msgBytes);

        // 5. 通过 WebSocket 发送
        ws.send(encrypted);
        console.log('[MessageSender] 发送成功:', cmd, 'seq:', this._seq);
        return true;
      } catch (e) {
        console.error('[MessageSender] 发送失败:', e);
        return false;
      }
    }
  }

  // ============================================================
  // Hook 层 - WebSocket 拦截
  // ============================================================

  // --- WebSocketHook：WebSocket 拦截器 ---
  // 通过 Proxy 代理 window.WebSocket 构造函数
  // 拦截 send 方法和 onmessage 事件，捕获通信数据
  // 支持监听启停控制（setCapturing / isCapturing）

  class WebSocketHook {
    /**
     * @param {function(string, Uint8Array): void} onCapture - 捕获回调
     *   direction: 'send' | 'receive'
     *   data: Uint8Array 数据副本
     */
    constructor(onCapture) {
      /** @type {function(string, Uint8Array): void} */
      this._onCapture = onCapture;
      /** @type {boolean} 是否正在捕获 */
      this._capturing = true;
      /** @type {WebSocket|null} 保存原始 WebSocket 构造函数引用 */
      this._OriginalWebSocket = null;
      /** @type {WebSocket|null} 最后一个活跃的 WebSocket 实例 */
      this._activeWebSocket = null;
    }

    /**
     * 安装 Hook，用 Proxy 替换全局 window.WebSocket
     * 任务 5.1：通过 Proxy 代理 window.WebSocket 构造函数
     * 采用非侵入式监控：只用 addEventListener 添加独立监听器，
     * 不拦截 onmessage 和 addEventListener，避免破坏游戏原始通信
     */
    install() {
      // 保存原始 WebSocket 引用（使用 _global 兼容 AI之王等管理器环境）
      this._OriginalWebSocket = _global.WebSocket;
      const self = this;

      // 使用 Proxy 代理 WebSocket 构造函数
      const ProxiedWebSocket = new Proxy(this._OriginalWebSocket, {
        // 拦截 new WebSocket(url, protocols) 调用
        construct(Target, args) {
          let ws;
          try {
            ws = new Target(...args);
          } catch (e) {
            console.error('[WebSocketHook] 创建 WebSocket 实例失败:', e);
            throw e;
          }

          // 保存为当前活跃连接
          self._activeWebSocket = ws;

          // 拦截 send 方法（任务 5.2）— 先透传再异步处理副本，安全
          self._hookSend(ws);

          // 非侵入式接收监控（任务 5.3）
          // 直接用 addEventListener 添加独立的 message 监听器
          // 不拦截 onmessage 和 addEventListener，完全不干扰游戏通信
          self._addReceiveMonitor(ws);

          return ws;
        },

        // 保持 WebSocket 的静态属性可访问（CONNECTING, OPEN, CLOSING, CLOSED）
        get(target, prop, receiver) {
          return Reflect.get(target, prop, receiver);
        }
      });

      // 替换全局 WebSocket（同时替换 window 和 _global，确保覆盖所有访问路径）
      _global.WebSocket = ProxiedWebSocket;
      if (_global !== window) {
        window.WebSocket = ProxiedWebSocket;
      }

      // 保持 prototype 链完整，使 instanceof 检查正常工作
      // AI之王等环境中 WebSocket.prototype 可能是只读的，赋值会报错
      try {
        Object.defineProperty(ProxiedWebSocket, 'prototype', {
          value: this._OriginalWebSocket.prototype,
          writable: false,
          configurable: false
        });
      } catch (e) {
        // prototype 不可写时跳过，仅影响 instanceof 检查，不影响核心通信功能
        console.warn('[WebSocketHook] 无法设置 prototype（环境限制），instanceof 检查可能不准确');
      }
    }

    /**
     * 拦截 WebSocket 实例的 send 方法
     * 任务 5.2：先透传原始数据，再异步处理副本
     * @param {WebSocket} ws - WebSocket 实例
     */
    _hookSend(ws) {
      const self = this;
      const originalSend = ws.send.bind(ws);

      ws.send = function (data) {
        try {
          // 先调用原始 send，保证数据不被修改地发送到服务器
          originalSend(data);
        } catch (e) {
          console.error('[WebSocketHook] 原始 send 调用失败:', e);
          throw e; // 原始 send 失败需要抛出，让游戏感知到错误
        }

        // 异步处理数据副本，不阻塞原始通信
        try {
          if (self._capturing && self._onCapture) {
            // 创建数据副本（Uint8Array）
            const copy = self._toUint8Array(data);
            if (copy) {
              // 使用 Promise.resolve().then 异步执行，避免阻塞
              Promise.resolve().then(() => {
                try {
                  self._onCapture('send', copy);
                } catch (e) {
                  console.error('[WebSocketHook] send 捕获回调执行失败:', e);
                }
              });
            }
          }
        } catch (e) {
          console.error('[WebSocketHook] send 数据副本处理失败:', e);
          // 异常不影响原始通信，已经成功发送
        }
      };
    }

    /**
     * 非侵入式接收监控
     * 任务 5.3：使用独立的 addEventListener 监听 message 事件
     * 不拦截 onmessage 和 addEventListener，完全不干扰游戏原始通信
     * @param {WebSocket} ws - WebSocket 实例
     */
    _addReceiveMonitor(ws) {
      const self = this;

      // 直接添加独立的 message 监听器，与游戏的监听器互不干扰
      ws.addEventListener('message', function (event) {
        try {
          if (self._capturing && self._onCapture) {
            const copy = self._toUint8Array(event.data);
            if (copy) {
              // 异步处理，不阻塞游戏消息处理
              Promise.resolve().then(() => {
                try {
                  self._onCapture('receive', copy);
                } catch (e) {
                  console.error('[WebSocketHook] receive 捕获回调执行失败:', e);
                }
              });
            }
          }
        } catch (e) {
          console.error('[WebSocketHook] 接收监控处理失败:', e);
          // 异常不影响游戏通信
        }
      });
    }

    /**
     * 将各种数据类型转换为 Uint8Array 副本
     * 支持 ArrayBuffer、Uint8Array、Blob（忽略，因为异步读取复杂度高）、string
     * @param {any} data - 原始数据
     * @returns {Uint8Array|null} 数据副本，无法转换时返回 null
     */
    _toUint8Array(data) {
      try {
        if (data instanceof ArrayBuffer) {
          return new Uint8Array(data.slice(0));
        }
        if (data instanceof Uint8Array) {
          return new Uint8Array(data);
        }
        if (ArrayBuffer.isView(data)) {
          return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        }
        if (typeof data === 'string') {
          // 字符串转 UTF-8 字节
          const encoder = new TextEncoder();
          return encoder.encode(data);
        }
        // Blob 等其他类型暂不处理
        return null;
      } catch (e) {
        console.error('[WebSocketHook] 数据转换为 Uint8Array 失败:', e);
        return null;
      }
    }

    /**
     * 设置捕获状态
     * 任务 5.4：暂停/恢复捕获，不影响原始通信
     * @param {boolean} enabled - true 恢复捕获，false 暂停捕获
     */
    setCapturing(enabled) {
      this._capturing = !!enabled;
    }

    /**
     * 获取当前捕获状态
     * 任务 5.4：查询是否正在捕获
     * @returns {boolean} 是否正在捕获
     */
    isCapturing() {
      return this._capturing;
    }

    /**
     * 获取当前活跃的 WebSocket 连接
     * 用于消息发送功能（需求 8）
     * @returns {WebSocket|null} 活跃的 WebSocket 实例
     */
    getActiveWebSocket() {
      return this._activeWebSocket;
    }
  }

  // ============================================================
  // UI 层 - 监控面板与交互
  // ============================================================

  // --- MonitorUI：监控面板 UI ---
  // 封装所有 UI 逻辑：悬浮按钮、面板框架、三个 Tab 页
  // 依赖：logManager, configManager, messageSender, wsHook

  /**
   * 监控面板 UI 类
   * 负责创建和管理所有 DOM 元素及交互逻辑
   */
  class MonitorUI {
    /**
     * @param {object} deps - 依赖注入
     * @param {LogManager} deps.logManager - 日志管理器
     * @param {ConfigManager} deps.configManager - 配置管理器
     * @param {MessageSender} deps.messageSender - 消息发送器
     * @param {WebSocketHook} deps.wsHook - WebSocket 拦截器
     */
    constructor(deps) {
      this._logManager = deps.logManager;
      this._configManager = deps.configManager;
      this._messageSender = deps.messageSender;
      this._wsHook = deps.wsHook;

      // UI 状态（最小核心数据，UI 从这些状态推导）
      this._panelVisible = false;
      this._activeTab = 'monitor'; // 'monitor' | 'send' | 'settings'
      this._expandedLogId = null;
      this._filterMode = 'all'; // 'all' | 'send' | 'receive' | 'noted'
      this._selectedLogIds = new Set(); // 勾选的日志 ID，用于批量下载
      this._downloadDirHandle = null; // 用户选择的下载目录 handle

      // DOM 元素引用
      this._floatBtn = null;
      this._panel = null;
      this._tabContents = {};
      this._logListEl = null;

      // 定时刷新日志列表的定时器
      this._refreshTimer = null;
    }

    // ========================================
    // 公共方法
    // ========================================

    /**
     * 创建所有 DOM 元素并注入页面
     * 入口方法，调用后 UI 即可使用
     */
    create() {
      this._injectStyles();
      this._createFloatButton();
      this._createPanel();
      this._startAutoRefresh();
      // 调试：确认 UI 创建完成（上线后删除）
      console.log('[咸鱼之王监控] UI create() 完成, floatBtn:', !!this._floatBtn, 'inDOM:', document.contains(this._floatBtn));
    }

    /**
     * 刷新日志列表显示
     * 从 logManager 获取最新数据并重新渲染
     */
    updateLogList() {
      if (!this._logListEl) return;
      const blacklist = this._configManager.getBlacklist();
      let logs = this._logManager.getFiltered(blacklist);

      // 按筛选模式过滤
      if (this._filterMode === 'send') {
        logs = logs.filter(entry => entry.direction === 'send');
      } else if (this._filterMode === 'receive') {
        logs = logs.filter(entry => entry.direction === 'receive');
      } else if (this._filterMode === 'noted') {
        const notedCmds = new Set(this._configManager.getNotedCmds());
        logs = logs.filter(entry => notedCmds.has(entry.cmd));
      }

      // 清空现有列表
      this._logListEl.textContent = '';

      if (logs.length === 0) {
        const emptyTip = document.createElement('div');
        emptyTip.className = 'xyzw-log-empty';
        const emptyTexts = {
          all: '暂无日志记录',
          send: '暂无请求日志',
          receive: '暂无响应日志',
          noted: '暂无备注协议的日志'
        };
        emptyTip.textContent = emptyTexts[this._filterMode] || '暂无日志记录';
        this._logListEl.appendChild(emptyTip);
        return;
      }

      // 倒序显示，最新的在最上面
      for (let i = logs.length - 1; i >= 0; i--) {
        this._logListEl.appendChild(this._createLogEntry(logs[i]));
      }
    }

    /**
     * 更新消息计数（徽章已移除，保留接口兼容）
     * @param {number} count - 消息总数
     */
    updateCount(count) {
      // 徽章已移除，无需更新
    }

    // ========================================
    // 样式注入（任务 8.3）
    // ========================================

    /** 注入全局 CSS 样式，使用 .xyzw- 前缀避免冲突 */
    _injectStyles() {
      const style = document.createElement('style');
      style.textContent = `
/* ===== 悬浮按钮 ===== */
/* 全局隐藏滚动条（保留滚动功能） */
.xyzw-panel *::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
.xyzw-panel * {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.xyzw-float-btn {
  position: fixed;
  font-size: 24px;
  cursor: pointer;
  z-index: 10001;
  transition: all 0.15s ease;
  user-select: none;
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  will-change: transform;
  pointer-events: auto;
  background: transparent;
  border: none;
  padding: 0;
  border-radius: 50%;
  box-shadow: none;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 默认位置放左上角，避免超出游戏 WebView 视口 */
  top: 5px;
  left: 5px;
}
.xyzw-float-btn:hover {
  transform: scale(1.2);
  filter: drop-shadow(0 2px 4px rgba(49, 130, 206, 0.4));
}
/* 拖拽中状态 */
.xyzw-dragging {
  cursor: grabbing !important;
  transform: scale(1.25) !important;
  z-index: 10002 !important;
  transition: transform 0.1s ease !important;
  filter: drop-shadow(0 3px 6px rgba(49, 130, 206, 0.6));
}
/* ===== 监控面板 ===== */
.xyzw-panel {
  position: fixed !important;
  top: 50% !important;
  left: 50% !important;
  transform: translate(-50%, -50%);
  width: 90vw;
  max-width: 420px;
  height: 75vh;
  background: #ffffff !important;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  z-index: 10000 !important;
  display: none;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #333;
  pointer-events: auto !important;
  visibility: visible !important;
  border: 1px solid #e8e8e8;
  transition: all 0.2s ease;
}
.xyzw-panel.xyzw-visible {
  display: flex;
}

/* ===== 标题栏 ===== */
.xyzw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
  flex-shrink: 0;
}
.xyzw-header-title {
  font-size: 15px;
  font-weight: 600;
  color: #1890ff;
}
.xyzw-header-close {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #999;
  font-size: 20px;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
}
.xyzw-header-close:active {
  background: rgba(0,0,0,0.05);
}

/* ===== Tab 栏 ===== */
.xyzw-tabs {
  display: flex;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
  flex-shrink: 0;
}
.xyzw-tab-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: #999;
  font-size: 14px;
  line-height: 1;
  letter-spacing: 0.5px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  touch-action: manipulation;
  min-height: 40px;
  text-align: center;
}
.xyzw-tab-btn.xyzw-active {
  color: #1890ff;
  border-bottom-color: #1890ff;
}

/* ===== Tab 内容区 ===== */
.xyzw-tab-content {
  flex: 1;
  overflow-y: auto;
  display: none;
  flex-direction: column;
}
.xyzw-tab-content.xyzw-visible {
  display: flex;
}

/* ===== 监控 Tab - 工具栏 ===== */
.xyzw-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  background: #ffffff;
  border-bottom: 1px solid #e8e8e8;
  flex-shrink: 0;
  align-items: center;
}
.xyzw-btn {
  min-height: 32px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
  white-space: nowrap;
  text-align: center;
}
.xyzw-btn:active {
  opacity: 0.7;
}
.xyzw-btn-primary {
  background: #1890ff;
  color: #fff;
  font-weight: 600;
}
.xyzw-btn-danger {
  background: #ff4d4f;
  color: #fff;
}
.xyzw-btn-secondary {
  background: #f0f0f0;
  color: #666;
}
.xyzw-btn-success {
  background: #52c41a;
  color: #fff;
  font-weight: 600;
}

/* ===== 日志列表 ===== */
.xyzw-log-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.xyzw-log-empty {
  text-align: center;
  color: #bbb;
  padding: 40px 0;
  font-size: 13px;
}
.xyzw-log-entry {
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
}
.xyzw-log-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
/* 方向标签：请求/响应 */
.xyzw-log-dir {
  font-size: 11px;
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}
.xyzw-log-dir-send {
  color: #fa8c16;
  background: #fff7e6;
  border: 1px solid #ffd591;
}
.xyzw-log-dir-receive {
  color: #52c41a;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
}
.xyzw-log-cmd {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #333;
  font-weight: 500;
}
.xyzw-log-time {
  color: #999;
  font-size: 12px;
  flex-shrink: 0;
}
.xyzw-log-duration {
  color: #1890ff;
  font-size: 12px;
  flex-shrink: 0;
  min-width: 40px;
  text-align: right;
}
.xyzw-log-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.xyzw-log-action-btn {
  padding: 4px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  color: #666;
  font-size: 12px;
  cursor: pointer;
  touch-action: manipulation;
  min-height: 28px;
}
.xyzw-log-action-btn:active {
  background: #f5f5f5;
}
/* 屏蔽按钮特殊样式 */
.xyzw-log-action-btn-block {
  color: #ff4d4f;
  border-color: #ffccc7;
}
.xyzw-log-action-btn-block:active {
  background: #fff1f0;
}
/* 下载按钮特殊样式 */
.xyzw-log-action-btn-download {
  color: #1890ff;
  border-color: #91d5ff;
}
.xyzw-log-action-btn-download:active {
  background: #e6f7ff;
}
.xyzw-log-detail {
  margin-top: 8px;
  padding: 10px;
  background: #f9f9f9;
  border-radius: 8px;
  border: 1px solid #e8e8e8;
  font-size: 12px;
  color: #555;
  overflow-y: auto;
  max-height: 240px;
}

/* ===== 详情覆盖层（与面板同尺寸） ===== */
.xyzw-detail-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #ffffff;
  z-index: 10;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.xyzw-detail-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
  flex-shrink: 0;
}
.xyzw-detail-overlay-title {
  font-size: 15px;
  font-weight: 600;
  color: #1890ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xyzw-detail-overlay-close {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #999;
  font-size: 20px;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
  flex-shrink: 0;
}
.xyzw-detail-overlay-close:active {
  background: rgba(0,0,0,0.05);
}
.xyzw-detail-overlay-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
/* 覆盖层内详情和JSON不限高度 */
.xyzw-detail-overlay .xyzw-log-detail {
  max-height: none;
  margin-top: 0;
}
.xyzw-detail-overlay .xyzw-detail-body-json {
  max-height: none;
}
/* 协议分析结果样式 */
.xyzw-detail-analysis {
  padding: 10px;
  margin-bottom: 8px;
  background: #f0f9ff;
  border: 1px solid #bae7ff;
  border-radius: 8px;
  font-size: 13px;
  color: #333;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-all;
}
/* 详情 - 元信息标签行 */
.xyzw-detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.xyzw-detail-meta-tag {
  display: inline-block;
  padding: 2px 8px;
  background: #e6f7ff;
  border: 1px solid #91d5ff;
  border-radius: 4px;
  font-size: 11px;
  color: #1890ff;
  white-space: nowrap;
}
/* 详情 - Body 标题 */
.xyzw-detail-body-title {
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
  text-align: left;
}
/* 详情 - Body JSON 内容 */
.xyzw-detail-body-json {
  margin: 0;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #333;
  white-space: pre-wrap;
  word-break: break-all;
  text-align: left;
  max-height: 200px;
  overflow-y: auto;
}

/* ===== 发送 Tab ===== */
.xyzw-send-form {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}
.xyzw-input-label {
  font-size: 13px;
  color: #999;
  margin-bottom: 2px;
}
.xyzw-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  background: #fff;
  color: #333;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  min-height: 40px;
}
.xyzw-input:focus {
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgba(24,144,255,0.1);
}
.xyzw-textarea {
  resize: vertical;
  min-height: 100px;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
}
.xyzw-send-msg {
  font-size: 13px;
  padding: 6px 0;
  min-height: 20px;
}
.xyzw-send-msg-error { color: #ff4d4f; }
.xyzw-send-msg-success { color: #52c41a; }

/* ===== 设置 Tab ===== */
.xyzw-settings {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  overflow-y: auto;
}
.xyzw-settings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.xyzw-settings-title {
  font-size: 14px;
  font-weight: 600;
  color: #1890ff;
}
.xyzw-blacklist-input-row {
  display: flex;
  gap: 8px;
}
.xyzw-blacklist-input-row .xyzw-input {
  flex: 1;
}
.xyzw-blacklist-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.xyzw-blacklist-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #f9f9f9;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-size: 13px;
}
.xyzw-blacklist-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #333;
}
.xyzw-blacklist-del-btn {
  padding: 2px 8px;
  border: none;
  border-radius: 4px;
  background: #ff4d4f;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  touch-action: manipulation;
  min-height: 26px;
  flex-shrink: 0;
}
.xyzw-help-section {
  padding: 10px;
  background: #f9f9f9;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  font-size: 13px;
  color: #666;
  line-height: 1.8;
}
.xyzw-help-section p {
  margin: 0 0 4px 0;
}

/* ===== 备注相关样式 ===== */
.xyzw-log-entry-noted {
  background: #fffbe6;
  border-left: 3px solid #faad14;
}
.xyzw-log-note-text {
  font-size: 12px;
  color: #d48806;
  margin-top: 4px;
  padding: 3px 8px;
  background: #fff7e6;
  border-radius: 4px;
  border: 1px solid #ffe58f;
  word-break: break-all;
}
.xyzw-log-action-btn-note {
  color: #faad14;
  border-color: #ffe58f;
}
.xyzw-log-action-btn-note:active {
  background: #fffbe6;
}
.xyzw-btn-noted-active {
  background: #faad14;
  color: #fff;
  font-weight: 600;
}
/* 勾选框样式 */
.xyzw-log-checkbox {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: #1890ff;
  margin: 0;
}
/* 筛选下拉样式 */
.xyzw-filter-select {
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  background: #fff;
  color: #333;
  font-size: 13px;
  cursor: pointer;
  outline: none;
}
.xyzw-filter-select:focus {
  border-color: #1890ff;
}
/* 备注编辑面板样式 */
.xyzw-note-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.3);
  z-index: 10003;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
.xyzw-note-dialog {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  width: 85vw;
  max-width: 340px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.xyzw-note-dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 10px;
  word-break: break-all;
}
.xyzw-note-dialog-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  font-size: 14px;
  color: #333;
  background: #fff;
  outline: none;
  box-sizing: border-box;
  min-height: 40px;
}
.xyzw-note-dialog-input:focus {
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgba(24,144,255,0.1);
}
.xyzw-note-dialog-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  justify-content: flex-end;
}

/* ===== 字典管理 ===== */
.xyzw-dict-info {
  font-size: 13px;
  color: #1890ff;
  font-weight: 500;
  padding: 10px 12px;
  background: #e6f7ff;
  border: 1px solid #91d5ff;
  border-radius: 8px;
  text-align: center;
  margin-bottom: 10px;
}
.xyzw-dict-btn-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}
.xyzw-dict-btn-row .xyzw-btn {
  width: 100%;
  min-height: 36px;
  font-size: 13px;
  border-radius: 8px;
}
.xyzw-dict-msg {
  font-size: 12px;
  padding: 6px 10px;
  min-height: 18px;
  border-radius: 6px;
  text-align: center;
}
.xyzw-dict-msg-success { color: #52c41a; background: #f6ffed; }
.xyzw-dict-msg-error { color: #ff4d4f; background: #fff2f0; }
.xyzw-dict-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 10px 0 6px;
  padding: 6px 10px;
  cursor: pointer;
  color: #8c8c8c;
  font-size: 12px;
  background: #fafafa;
  border-radius: 6px;
  border: 1px solid #f0f0f0;
  transition: background 0.15s;
}
.xyzw-dict-list-header:active {
  background: #f0f0f0;
}
.xyzw-dict-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  max-height: 280px;
  overflow-y: auto;
  padding-right: 2px;
}
.xyzw-dict-empty {
  text-align: center;
  color: #bbb;
  padding: 24px 0;
  font-size: 13px;
}
.xyzw-dict-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  font-size: 12px;
  transition: background 0.15s;
}
.xyzw-dict-item:active {
  background: #f0f0f0;
}
.xyzw-dict-item-cmd {
  flex-shrink: 0;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1890ff;
  font-weight: 600;
  font-size: 12px;
  font-family: 'Courier New', Consolas, monospace;
}
.xyzw-dict-item-note {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #595959;
}
      `;
      // 插入样式（与 xh.js 一致的注入方式）
      (document.head || document.documentElement).appendChild(style);
    }

    // ========================================
    // 悬浮按钮（任务 8.1）
    // ========================================

    /** 创建悬浮按钮，固定右上角，纯 emoji 显示 */
    _createFloatButton() {
      // 移除已存在的按钮（防止重复创建）
      document.getElementById('xyzwFloatBtn')?.remove();

      // 使用 div 而非 button，避免被游戏环境的按钮样式覆盖（参考 xh.js / 星驰实现）
      this._floatBtn = document.createElement('div');
      this._floatBtn.id = 'xyzwFloatBtn';
      this._floatBtn.className = 'xyzw-float-btn';
      this._floatBtn.textContent = '🌨️';
      this._floatBtn.title = '打开/关闭协议监控面板';
      // 内联样式保底 — 与 xh.js 的 .script-tool-toggle 保持一致的关键属性
      // 包含 width/height/display:flex 确保在 AI之王管理器中可见
      // 放左上角避免被游戏右上角 UI 遮挡或超出视口
      this._floatBtn.style.cssText = [
        'position:fixed',
        'top:5px',
        'left:5px',
        'width:36px',
        'height:36px',
        'font-size:24px',
        'cursor:pointer',
        'z-index:10001',
        'user-select:none',
        'touch-action:none',
        '-webkit-user-select:none',
        'will-change:transform',
        'pointer-events:auto',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'background:transparent',
        'border:none',
        'padding:0',
        'border-radius:50%',
        'box-shadow:none',
        'transition:all 0.15s ease',
      ].join(';');

      // 拖拽 + 点击逻辑（参考星驰实现）
      this._setupFloatBtnDrag();

      // 插入到 DOM
      document.body.appendChild(this._floatBtn);
    }

    /**
     * 设置悬浮按钮的拖拽功能
     * 支持鼠标和触摸，移动超过 3px 判定为拖拽，否则为点击
     * 拖拽结束后保存位置到 localStorage，下次打开自动恢复
     */
    _setupFloatBtnDrag() {
      const btn = this._floatBtn;
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let offsetX = 0;
      let offsetY = 0;
      let animationFrameId = null;
      let pendingX = null;
      let pendingY = null;
      const self = this;

      // 恢复上次保存的位置
      const saved = localStorage.getItem('xyzw_float_btn_pos');
      if (saved) {
        try {
          const { left, top } = JSON.parse(saved);
          btn.style.left = left + 'px';
          btn.style.top = top + 'px';
          btn.style.right = 'auto';
          btn.style.bottom = 'auto';
        } catch (e) {
          // 恢复失败，使用默认位置
        }
      }

      // 使用 requestAnimationFrame 更新位置，提升流畅度
      const updatePosition = () => {
        if (pendingX !== null && pendingY !== null) {
          btn.style.left = pendingX + 'px';
          btn.style.top = pendingY + 'px';
          pendingX = null;
          pendingY = null;
        }
        animationFrameId = null;
      };

      // 统一清理函数 — 确保所有监听器被移除，防止"粘住"
      const cleanup = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('mouseleave', onMouseUp);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        // iframe 环境：也从 top 窗口移除监听（跨 iframe 兜底）
        try {
          if (window.top && window.top !== window) {
            window.top.document.removeEventListener('mouseup', onMouseUp);
            window.top.document.removeEventListener('mousemove', onMouseMove);
          }
        } catch (e) {
          // 跨域 iframe 无法访问 top，忽略
        }
        window.removeEventListener('blur', cleanup);

        if (isDragging) {
          btn.classList.remove('xyzw-dragging');
          // 取消未完成的动画帧，立即应用最后位置
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            if (pendingX !== null && pendingY !== null) {
              btn.style.left = pendingX + 'px';
              btn.style.top = pendingY + 'px';
            }
          }
          // 保存位置到 localStorage
          const position = {
            left: parseInt(btn.style.left) || 0,
            top: parseInt(btn.style.top) || 0
          };
          localStorage.setItem('xyzw_float_btn_pos', JSON.stringify(position));
        }
        isDragging = false;
      };

      // 通用移动处理
      const processMove = (clientX, clientY, preventDefault) => {
        if (!isDragging) {
          if (Math.abs(clientX - startX) > 3 || Math.abs(clientY - startY) > 3) {
            isDragging = true;
            btn.classList.add('xyzw-dragging');
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
          } else {
            return;
          }
        }
        if (preventDefault) preventDefault();

        let newX = clientX - offsetX;
        let newY = clientY - offsetY;
        const margin = 5;
        const maxX = window.innerWidth - btn.offsetWidth - margin;
        const maxY = window.innerHeight - btn.offsetHeight - margin;
        newX = Math.max(margin, Math.min(newX, maxX));
        newY = Math.max(margin, Math.min(newY, maxY));

        pendingX = newX;
        pendingY = newY;
        if (!animationFrameId) {
          animationFrameId = requestAnimationFrame(updatePosition);
        }
      };

      // 鼠标事件处理
      const onMouseMove = (e) => processMove(e.clientX, e.clientY, null);
      const onMouseUp = () => {
        const wasDragging = isDragging;
        cleanup();
        // 非拖拽 = 点击，切换面板
        if (!wasDragging) {
          self._togglePanel();
        }
      };

      // 触摸事件处理
      const onTouchMove = (e) => {
        if (e.touches.length !== 1) return;
        processMove(e.touches[0].clientX, e.touches[0].clientY, () => e.preventDefault());
      };
      const onTouchEnd = () => {
        const wasDragging = isDragging;
        cleanup();
        if (!wasDragging) {
          self._togglePanel();
        }
      };

      // mousedown 入口
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        startX = e.clientX;
        startY = e.clientY;
        offsetX = e.clientX - btn.offsetLeft;
        offsetY = e.clientY - btn.offsetTop;
        isDragging = false;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('mouseleave', onMouseUp);
        // iframe 兜底：在 top 窗口也监听 mouseup/mousemove
        try {
          if (window.top && window.top !== window) {
            window.top.document.addEventListener('mouseup', onMouseUp);
            window.top.document.addEventListener('mousemove', onMouseMove);
          }
        } catch (e2) {
          // 跨域 iframe 无法访问 top，忽略
        }
        // 窗口失焦兜底 — 防止鼠标在外部释放后回来仍然粘住
        window.addEventListener('blur', cleanup);
      });

      // touchstart 入口
      btn.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) return;
        e.preventDefault();
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        offsetX = e.touches[0].clientX - btn.offsetLeft;
        offsetY = e.touches[0].clientY - btn.offsetTop;
        isDragging = false;

        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
        window.addEventListener('blur', cleanup);
      }, { passive: false });

      // 触摸取消时清理
      btn.addEventListener('touchcancel', cleanup);
    }

    // ========================================
    // 面板框架（任务 8.2）
    // ========================================

    /** 创建监控面板：标题栏 + Tab 栏 + 三个 Tab 内容区 */
    _createPanel() {
      // 移除已存在的面板（防止重复创建）
      document.getElementById('xyzwPanel')?.remove();

      this._panel = document.createElement('div');
      this._panel.id = 'xyzwPanel';
      this._panel.className = 'xyzw-panel';

      // 标题栏
      this._panel.appendChild(this._createHeader());

      // Tab 栏
      this._panel.appendChild(this._createTabBar());

      // 四个 Tab 内容区
      this._tabContents.monitor = this._createMonitorTab();
      this._tabContents.send = this._createSendTab();
      this._tabContents.dict = this._createDictTab();
      this._tabContents.settings = this._createSettingsTab();

      this._panel.appendChild(this._tabContents.monitor);
      this._panel.appendChild(this._tabContents.send);
      this._panel.appendChild(this._tabContents.dict);
      this._panel.appendChild(this._tabContents.settings);

      // 默认显示监控 Tab
      this._switchTab('monitor');

      // 插入到 DOM（兼容 iframe 环境）
      const container = document.body || document.documentElement;
      container.appendChild(this._panel);
    }

    /** 创建标题栏（标题 + 关闭按钮） */
    _createHeader() {
      const header = document.createElement('div');
      header.className = 'xyzw-header';

      const title = document.createElement('span');
      title.className = 'xyzw-header-title';
      title.textContent = '🐟 咸鱼监控';
      title.style.cursor = 'pointer';
      title.addEventListener('click', () => {
        this._showHelpOverlay();
      });
      header.appendChild(title);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'xyzw-header-close';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => {
        this._togglePanel();
      });
      header.appendChild(closeBtn);

      return header;
    }

    /** 创建 Tab 切换栏 */
    _createTabBar() {
      const tabs = document.createElement('div');
      tabs.className = 'xyzw-tabs';

      const tabDefs = [
        { key: 'monitor', label: '监控' },
        { key: 'send', label: '发送' },
        { key: 'dict', label: '字典' },
        { key: 'settings', label: '设置' }
      ];

      // 保存 Tab 按钮引用，用于切换时更新样式
      this._tabBtns = {};

      tabDefs.forEach(def => {
        const btn = document.createElement('button');
        btn.className = 'xyzw-tab-btn';
        btn.textContent = def.label;
        btn.addEventListener('click', () => {
          this._switchTab(def.key);
        });
        this._tabBtns[def.key] = btn;
        tabs.appendChild(btn);
      });

      return tabs;
    }

    // ========================================
    // 监控 Tab（任务 9）
    // ========================================

    /** 创建监控 Tab 内容区：工具栏 + 日志列表 */
    _createMonitorTab() {
      const container = document.createElement('div');
      container.className = 'xyzw-tab-content';

      // 工具栏：开始/停止 + 清空
      const toolbar = document.createElement('div');
      toolbar.className = 'xyzw-toolbar';

      // 开始/停止监听按钮（任务 9.2）
      this._captureBtn = document.createElement('button');
      this._captureBtn.className = 'xyzw-btn xyzw-btn-secondary';
      this._updateCaptureBtn();
      this._captureBtn.addEventListener('click', () => {
        const current = this._wsHook.isCapturing();
        this._wsHook.setCapturing(!current);
        this._updateCaptureBtn();
      });
      toolbar.appendChild(this._captureBtn);

      // 清空日志按钮（任务 9.3）
      const clearBtn = document.createElement('button');
      clearBtn.className = 'xyzw-btn xyzw-btn-secondary';
      clearBtn.style.color = '#fa8c16';
      clearBtn.style.fontWeight = '600';
      clearBtn.textContent = '清空';
      clearBtn.addEventListener('click', () => {
        this._logManager.clear();
        this._expandedLogId = null;
        this.updateLogList();
        this.updateCount(0);
      });
      toolbar.appendChild(clearBtn);

      // 全选/取消全选按钮
      this._selectAllBtn = document.createElement('button');
      this._selectAllBtn.className = 'xyzw-btn xyzw-btn-secondary';
      this._selectAllBtn.textContent = '全选';
      this._selectAllBtn.addEventListener('click', () => {
        this._toggleSelectAll();
      });
      toolbar.appendChild(this._selectAllBtn);

      // 批量下载按钮 — 下载勾选的日志条目
      const batchDownloadBtn = document.createElement('button');
      batchDownloadBtn.className = 'xyzw-btn xyzw-btn-secondary';
      batchDownloadBtn.textContent = '批量下载';
      batchDownloadBtn.addEventListener('click', () => {
        this._downloadSelectedLogs();
      });
      toolbar.appendChild(batchDownloadBtn);

      // 筛选下拉 — 全部/请求/响应/备注
      this._filterSelect = document.createElement('select');
      this._filterSelect.className = 'xyzw-filter-select';
      const filterOptions = [
        { value: 'all', label: '全部' },
        { value: 'send', label: '请求' },
        { value: 'receive', label: '响应' },
        { value: 'noted', label: '备注' }
      ];
      filterOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        this._filterSelect.appendChild(option);
      });
      this._filterSelect.addEventListener('change', () => {
        this._filterMode = this._filterSelect.value;
        this._selectedLogIds.clear();
        this.updateLogList();
      });
      toolbar.appendChild(this._filterSelect);

      container.appendChild(toolbar);

      // 日志列表区域（任务 9.1）
      this._logListEl = document.createElement('div');
      this._logListEl.className = 'xyzw-log-list';
      container.appendChild(this._logListEl);

      return container;
    }

    /** 更新开始/停止按钮的文本和样式 */
    _updateCaptureBtn() {
      if (!this._captureBtn) return;
      const capturing = this._wsHook.isCapturing();
      this._captureBtn.textContent = capturing ? '停止' : '开始';
      // 不用红色底色，统一浅灰背景，用字体颜色区分状态
      this._captureBtn.className = 'xyzw-btn xyzw-btn-secondary';
      this._captureBtn.style.color = capturing ? '#ff4d4f' : '#52c41a';
      this._captureBtn.style.fontWeight = '600';
    }

    /**
     * 创建单条日志条目 DOM
     * @param {object} entry - 日志条目对象
     * @returns {HTMLElement} 日志条目 DOM 元素
     */
    _createLogEntry(entry) {
      const el = document.createElement('div');
      el.className = 'xyzw-log-entry';
      // 标记条目ID，用于关闭详情覆盖层后滚动定位
      el.dataset.logId = entry.id;

      // 检查该 cmd 是否有备注，有则高亮显示
      const note = entry.cmd ? this._configManager.getNote(entry.cmd) : null;
      if (note) {
        el.classList.add('xyzw-log-entry-noted');
      }

      // 摘要行：勾选框 + 方向标签 + cmd + 时间 + 耗时
      const summary = document.createElement('div');
      summary.className = 'xyzw-log-summary';

      // 勾选框（用于批量下载）
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'xyzw-log-checkbox';
      checkbox.checked = this._selectedLogIds.has(entry.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this._selectedLogIds.add(entry.id);
        } else {
          this._selectedLogIds.delete(entry.id);
        }
      });
      summary.appendChild(checkbox);

      // 方向标签（"请求"/"响应"）
      const dirEl = document.createElement('span');
      dirEl.className = 'xyzw-log-dir ' +
        (entry.direction === 'send' ? 'xyzw-log-dir-send' : 'xyzw-log-dir-receive');
      dirEl.textContent = entry.direction === 'send' ? '请求' : '响应';
      summary.appendChild(dirEl);

      // 命令名称
      const cmdEl = document.createElement('span');
      cmdEl.className = 'xyzw-log-cmd';
      cmdEl.textContent = entry.cmd || '(unknown)';
      summary.appendChild(cmdEl);

      // 时间 HH:MM:SS
      const timeEl = document.createElement('span');
      timeEl.className = 'xyzw-log-time';
      timeEl.textContent = this._formatTime(entry.timestamp);
      summary.appendChild(timeEl);

      // 耗时
      if (entry.duration != null && entry.duration > 0) {
        const durEl = document.createElement('span');
        durEl.className = 'xyzw-log-duration';
        durEl.textContent = entry.duration + 'ms';
        summary.appendChild(durEl);
      }

      el.appendChild(summary);

      // 如果有备注，显示备注文本
      if (note) {
        const noteEl = document.createElement('div');
        noteEl.className = 'xyzw-log-note-text';
        noteEl.textContent = note;
        el.appendChild(noteEl);
      }

      // 操作按钮行：展开 + 复制 + 下载 + 备注 + 屏蔽
      const actions = document.createElement('div');
      actions.className = 'xyzw-log-actions';

      // 展开/收起按钮
      const expandBtn = document.createElement('button');
      expandBtn.className = 'xyzw-log-action-btn';
      expandBtn.textContent = '展开';

      expandBtn.addEventListener('click', () => {
        // 弹出全屏详情覆盖层
        this._showDetailOverlay(entry);
      });
      actions.appendChild(expandBtn);

      // 复制按钮
      const copyBtn = document.createElement('button');
      copyBtn.className = 'xyzw-log-action-btn';
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', () => {
        this._copyLogToClipboard(entry, copyBtn);
      });
      actions.appendChild(copyBtn);

      // 下载按钮 — 将该条日志导出为 JSON 文件
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'xyzw-log-action-btn xyzw-log-action-btn-download';
      downloadBtn.textContent = '下载';
      downloadBtn.addEventListener('click', () => {
        this._downloadLogAsJson(entry);
      });
      actions.appendChild(downloadBtn);

      // 备注按钮 — 为该 cmd 添加/编辑备注
      if (entry.cmd) {
        const noteBtn = document.createElement('button');
        noteBtn.className = 'xyzw-log-action-btn xyzw-log-action-btn-note';
        noteBtn.textContent = note ? '改备注' : '备注';
        noteBtn.addEventListener('click', () => {
          this._handleEditNote(entry.cmd);
        });
        actions.appendChild(noteBtn);
      }

      // 屏蔽按钮 — 将该 cmd 加入黑名单
      if (entry.cmd) {
        const blockBtn = document.createElement('button');
        blockBtn.className = 'xyzw-log-action-btn xyzw-log-action-btn-block';
        blockBtn.textContent = '屏蔽';
        blockBtn.addEventListener('click', () => {
          this._configManager.addToBlacklist(entry.cmd);
          this.updateLogList();
          // 同步刷新设置页的黑名单列表
          this._refreshBlacklistUI();
        });
        actions.appendChild(blockBtn);
      }

      el.appendChild(actions);

      return el;
    }

    /**
     * 创建日志详情区域（JSON 格式化内容）
     * @param {object} entry - 日志条目
     * @returns {HTMLElement} 详情 DOM 元素
     */
    _createLogDetail(entry) {
      const detail = document.createElement('div');
      detail.className = 'xyzw-log-detail';

      try {
        // 元信息区域 — 用标签形式展示关键字段
        const metaEl = document.createElement('div');
        metaEl.className = 'xyzw-detail-meta';

        const metaItems = [
          { label: 'cmd', value: entry.cmd },
          { label: '方向', value: entry.direction === 'send' ? '请求' : '响应' },
          { label: 'seq', value: entry.seq },
          { label: 'ack', value: entry.ack },
          { label: '大小', value: (entry.rawSize || 0) + ' B' },
          { label: '耗时', value: (entry.duration || 0) + ' ms' }
        ];

        metaItems.forEach(item => {
          const tag = document.createElement('span');
          tag.className = 'xyzw-detail-meta-tag';
          tag.textContent = item.label + ': ' + item.value;
          metaEl.appendChild(tag);
        });

        detail.appendChild(metaEl);

        // Body 区域 — 始终显示完整 JSON，左对齐
        const bodyTitle = document.createElement('div');
        bodyTitle.className = 'xyzw-detail-body-title';
        bodyTitle.textContent = 'Body:';
        detail.appendChild(bodyTitle);

        const bodyPre = document.createElement('pre');
        bodyPre.className = 'xyzw-detail-body-json';
        const bodyData = entry.body !== null && entry.body !== undefined ? entry.body : {};
        bodyPre.textContent = JSON.stringify(bodyData, null, 2);
        detail.appendChild(bodyPre);
      } catch (e) {
        detail.textContent = '(无法序列化)';
      }
      return detail;
    }

    /**
     * 弹出使用说明覆盖层，复用 .xyzw-detail-overlay 样式
     */
    _showHelpOverlay() {
      // 移除已存在的覆盖层
      this._panel.querySelector('.xyzw-detail-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.className = 'xyzw-detail-overlay';

      // 标题栏
      const header = document.createElement('div');
      header.className = 'xyzw-detail-overlay-header';

      const title = document.createElement('span');
      title.className = 'xyzw-detail-overlay-title';
      title.textContent = '📖 使用说明';
      header.appendChild(title);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'xyzw-detail-overlay-close';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => {
        overlay.remove();
      });
      header.appendChild(closeBtn);

      overlay.appendChild(header);

      // 内容区域
      const body = document.createElement('div');
      body.className = 'xyzw-detail-overlay-body';
      body.style.cssText = 'padding:16px;line-height:1.8;font-size:13px;color:#d9d9d9;';

      const sections = [
        { title: '🔍 监控功能', items: [
          '自动捕获 WebSocket 协议消息，支持加密解密和 BON 解码',
          '点击日志条目可展开查看详情，点击「展开」查看完整协议分析',
          '支持按方向（请求/响应）和备注筛选日志',
          '支持勾选多条日志批量下载为 JSON 文件'
        ]},
        { title: '📤 发送功能', items: [
          '输入 cmd 和 JSON body 可向服务器发送自定义协议消息',
          '发送的消息会自动加密编码，与游戏原生协议格式一致'
        ]},
        { title: '📚 字典功能', items: [
          '支持导入 JSON / TXT / JS 格式的协议字典文件',
          '支持将手动备注同步到字典库',
          '字典中的协议说明会自动显示在日志分析中',
          '导出字典可备份或分享给其他用户'
        ]},
        { title: '⚙️ 设置功能', items: [
          '黑名单管理：屏蔽不关心的协议命令，减少日志干扰',
          '被屏蔽的命令不会出现在监控日志中'
        ]},
        { title: '💡 小技巧', items: [
          '右键日志条目可快速添加备注或加入黑名单',
          '协议分析器会自动识别模块、动作和 body 字段含义',
          '字典优先级：用户备注 > 字典库 > 自动推断'
        ]}
      ];

      for (const section of sections) {
        const sTitle = document.createElement('div');
        sTitle.style.cssText = 'font-size:14px;font-weight:600;color:#e6e6e6;margin:12px 0 6px;';
        sTitle.textContent = section.title;
        body.appendChild(sTitle);

        for (const item of section.items) {
          const p = document.createElement('div');
          p.style.cssText = 'padding-left:8px;margin:3px 0;';
          p.textContent = '• ' + item;
          body.appendChild(p);
        }
      }

      overlay.appendChild(body);
      this._panel.appendChild(overlay);
    }

    /**
     * 弹出详情覆盖层，在面板内部以同尺寸展示协议详情
     * @param {object} entry - 日志条目
     */
    _showDetailOverlay(entry) {
      // 移除已存在的覆盖层
      this._panel.querySelector('.xyzw-detail-overlay')?.remove();

      // 记录当前查看的条目ID，用于关闭后滚动定位
      this._lastViewedLogId = entry.id;

      const overlay = document.createElement('div');
      overlay.className = 'xyzw-detail-overlay';

      // 标题栏：cmd 名称 + 返回按钮
      const header = document.createElement('div');
      header.className = 'xyzw-detail-overlay-header';

      const title = document.createElement('span');
      title.className = 'xyzw-detail-overlay-title';
      title.textContent = '📋 ' + (entry.cmd || '(unknown)');
      header.appendChild(title);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'xyzw-detail-overlay-close';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => {
        overlay.remove();
        // 关闭后滚动到上次查看的条目
        this._scrollToLogEntry(this._lastViewedLogId);
      });
      header.appendChild(closeBtn);

      overlay.appendChild(header);

      // 内容区域：分析结果 + 详情
      const body = document.createElement('div');
      body.className = 'xyzw-detail-overlay-body';

      // 协议分析结果
      const userNote = entry.cmd ? this._configManager.getNote(entry.cmd) : null;
      const dictNote = entry.cmd ? this._configManager.getDictEntry(entry.cmd) : null;
      const analysis = ProtocolAnalyzer.analyze(entry.cmd, entry.body, entry.direction, userNote, dictNote);
      const analysisEl = document.createElement('div');
      analysisEl.className = 'xyzw-detail-analysis';
      analysisEl.textContent = analysis;
      body.appendChild(analysisEl);

      body.appendChild(this._createLogDetail(entry));
      overlay.appendChild(body);

      // 插入到面板内部，覆盖在面板内容之上
      this._panel.appendChild(overlay);
    }

    /**
     * 滚动日志列表到指定条目
     * @param {number} logId - 日志条目ID
     */
    _scrollToLogEntry(logId) {
      if (!logId) return;
      const target = this._panel.querySelector(`[data-log-id="${logId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 短暂高亮提示
        target.style.background = '#e6f7ff';
        setTimeout(() => {
          target.style.background = '';
        }, 1500);
      }
    }

    /**
     * 复制日志 JSON 到剪贴板
     * 展开状态复制完整消息结构，未展开状态只复制 body
     * @param {object} entry - 日志条目
     * @param {HTMLElement} btn - 复制按钮，用于显示反馈
     */
    _copyLogToClipboard(entry, btn) {
      let text;
      try {
        if (this._expandedLogId === entry.id) {
          // 展开状态：复制完整消息结构
          const fullData = {
            cmd: entry.cmd,
            direction: entry.direction === 'send' ? '请求' : '响应',
            seq: entry.seq,
            ack: entry.ack,
            time: entry.time,
            rawSize: entry.rawSize,
            duration: entry.duration || 0,
            body: entry.body !== null && entry.body !== undefined ? entry.body : {}
          };
          text = JSON.stringify(fullData, null, 2);
        } else {
          // 未展开状态：只复制 body
          const bodyData = entry.body !== null && entry.body !== undefined ? entry.body : {};
          text = JSON.stringify(bodyData, null, 2);
        }
      } catch (e) {
        text = '(无法序列化)';
      }
      navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = '已复制 ✓';
        setTimeout(() => { btn.textContent = original; }, 1500);
      }).catch(err => {
        console.error('[MonitorUI] 复制到剪贴板失败:', err);
        btn.textContent = '复制失败';
        setTimeout(() => { btn.textContent = '复制'; }, 1500);
      });
    }

    /**
     * 将单条日志导出为 JSON 文件并触发下载
     * 使用通用 _saveFile 方法，支持 showSaveFilePicker 选路径
     * @param {object} entry - 日志条目
     */
    _downloadLogAsJson(entry) {
      const exportData = this._buildExportEntry(entry);
      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const fileName = this._buildLogFileName(entry);
      this._saveFile(blob, fileName).catch(e => {
        console.error('[MonitorUI] 下载日志失败:', e);
      });
    }

    /**
     * 刷新设置页的黑名单列表 UI
     * 在监控页点击"屏蔽"后调用，保持设置页数据同步
     */
    _refreshBlacklistUI() {
      this._renderBlacklist();
    }

    /**
     * 处理备注编辑
     * 创建自定义对话框让用户输入备注文本（不使用 prompt，兼容 iframe 环境）
     * @param {string} cmd - 命令名称
     */
    _handleEditNote(cmd) {
      const currentNote = this._configManager.getNote(cmd) || '';

      // 创建遮罩层
      const overlay = document.createElement('div');
      overlay.className = 'xyzw-note-overlay';

      // 对话框容器
      const dialog = document.createElement('div');
      dialog.className = 'xyzw-note-dialog';

      // 标题
      const title = document.createElement('div');
      title.className = 'xyzw-note-dialog-title';
      title.textContent = '为 ' + cmd + ' 添加备注';
      dialog.appendChild(title);

      // 输入框
      const input = document.createElement('input');
      input.className = 'xyzw-note-dialog-input';
      input.type = 'text';
      input.value = currentNote;
      input.placeholder = '输入备注（留空删除）';
      dialog.appendChild(input);

      // 按钮行
      const actionsRow = document.createElement('div');
      actionsRow.className = 'xyzw-note-dialog-actions';

      // 取消按钮
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'xyzw-btn xyzw-btn-secondary';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
      });
      actionsRow.appendChild(cancelBtn);

      // 确认按钮
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'xyzw-btn xyzw-btn-primary';
      confirmBtn.textContent = '确认';
      confirmBtn.addEventListener('click', () => {
        const newNote = input.value;
        if (newNote.trim() === '') {
          this._configManager.removeNote(cmd);
        } else {
          this._configManager.setNote(cmd, newNote);
        }
        overlay.remove();
        this.updateLogList();
      });
      actionsRow.appendChild(confirmBtn);

      dialog.appendChild(actionsRow);
      overlay.appendChild(dialog);

      // 点击遮罩层关闭（点击对话框外部区域）
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
        }
      });

      // 回车确认
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          confirmBtn.click();
        }
      });

      // 插入到 DOM，优先用当前文档的 body
      const container = document.body || document.documentElement;
      container.appendChild(overlay);

      // 自动聚焦输入框
      setTimeout(() => input.focus(), 50);
    }

    /**
     * 切换全选/取消全选
     * 获取当前过滤后的日志列表，全选或全部取消
     */
    _toggleSelectAll() {
      const blacklist = this._configManager.getBlacklist();
      let logs = this._logManager.getFiltered(blacklist);

      // 按当前筛选模式过滤
      if (this._filterMode === 'send') {
        logs = logs.filter(entry => entry.direction === 'send');
      } else if (this._filterMode === 'receive') {
        logs = logs.filter(entry => entry.direction === 'receive');
      } else if (this._filterMode === 'noted') {
        const notedCmds = new Set(this._configManager.getNotedCmds());
        logs = logs.filter(entry => notedCmds.has(entry.cmd));
      }

      // 判断当前是否已全选
      const allSelected = logs.length > 0 && logs.every(entry => this._selectedLogIds.has(entry.id));

      if (allSelected) {
        // 取消全选
        logs.forEach(entry => this._selectedLogIds.delete(entry.id));
      } else {
        // 全选
        logs.forEach(entry => this._selectedLogIds.add(entry.id));
      }

      this.updateLogList();
    }

    /**
     * 下载勾选的日志条目
     * 弹出对话框让用户选择：逐个下载 JSON / 打包为 ZIP 压缩包
     */
    _downloadSelectedLogs() {
      if (this._selectedLogIds.size === 0) {
        alert('请先勾选要下载的日志条目');
        return;
      }

      // 从 logManager 获取所有日志，按 ID 筛选
      const blacklist = this._configManager.getBlacklist();
      const allLogs = this._logManager.getFiltered(blacklist);
      const selectedLogs = allLogs.filter(entry => this._selectedLogIds.has(entry.id));

      if (selectedLogs.length === 0) {
        alert('选中的日志已被清空或过滤');
        return;
      }

      // 弹出下载方式选择对话框
      this._showBatchDownloadDialog(selectedLogs);
    }

    /**
     * 显示批量下载方式选择对话框
     * 用户可选择：逐个下载 JSON 文件 / 打包为 ZIP 压缩包（可自定义压缩包名）
     * @param {object[]} logs - 要下载的日志条目数组
     */
    _showBatchDownloadDialog(logs) {
      // 创建遮罩层（复用备注对话框的样式）
      const overlay = document.createElement('div');
      overlay.className = 'xyzw-note-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'xyzw-note-dialog';

      // 标题
      const title = document.createElement('div');
      title.className = 'xyzw-note-dialog-title';
      title.textContent = '批量下载 (' + logs.length + ' 条协议)';
      dialog.appendChild(title);

      // 压缩包名称输入框
      const nameLabel = document.createElement('div');
      nameLabel.style.cssText = 'font-size:12px;color:#999;margin-bottom:4px;';
      nameLabel.textContent = '压缩包名称（选择压缩包下载时使用）';
      dialog.appendChild(nameLabel);

      const defaultZipName = '咸鱼监控_批量导出_' + this._buildBeijingTimeTag();

      const nameInput = document.createElement('input');
      nameInput.className = 'xyzw-note-dialog-input';
      nameInput.type = 'text';
      nameInput.value = defaultZipName;
      nameInput.placeholder = '输入压缩包名称';
      dialog.appendChild(nameInput);

      // 按钮行
      const actionsRow = document.createElement('div');
      actionsRow.className = 'xyzw-note-dialog-actions';
      actionsRow.style.flexWrap = 'wrap';

      // 取消按钮
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'xyzw-btn xyzw-btn-secondary';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', () => overlay.remove());
      actionsRow.appendChild(cancelBtn);

      // 逐个下载按钮
      const singleBtn = document.createElement('button');
      singleBtn.className = 'xyzw-btn xyzw-btn-primary';
      singleBtn.textContent = '逐个下载';
      singleBtn.addEventListener('click', () => {
        overlay.remove();
        this._batchDownloadSingle(logs);
      });
      actionsRow.appendChild(singleBtn);

      // 压缩包下载按钮
      const zipBtn = document.createElement('button');
      zipBtn.className = 'xyzw-btn xyzw-btn-success';
      zipBtn.textContent = '压缩包下载';
      zipBtn.addEventListener('click', () => {
        const zipName = nameInput.value.trim() || defaultZipName;
        overlay.remove();
        this._batchDownloadZip(logs, zipName);
      });
      actionsRow.appendChild(zipBtn);

      dialog.appendChild(actionsRow);
      overlay.appendChild(dialog);

      // 点击遮罩关闭
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });

      const container = document.body || document.documentElement;
      container.appendChild(overlay);

      // 自动选中压缩包名称文本，方便修改
      setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
    }

    /**
     * 逐个下载选中的日志为独立 JSON 文件
     * 每条协议一个文件，间隔 200ms 避免浏览器拦截
     * @param {object[]} logs - 日志条目数组
     */
    async _batchDownloadSingle(logs) {
      for (let i = 0; i < logs.length; i++) {
        const entry = logs[i];
        const exportData = this._buildExportEntry(entry);
        const jsonStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const fileName = this._buildLogFileName(entry);
        await this._saveFile(blob, fileName);
        // 间隔 200ms，避免浏览器拦截连续下载
        if (i < logs.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
      // 下载完成后自动取消勾选
      this._selectedLogIds.clear();
      this.updateLogList();
    }

    /**
     * 将选中的日志打包为 ZIP 压缩包下载
     * 每条协议一个 JSON 文件，全部放入 ZIP 中
     * @param {object[]} logs - 日志条目数组
     * @param {string} zipName - 压缩包名称（不含 .zip 后缀）
     */
    async _batchDownloadZip(logs, zipName) {
      // 动态加载 JSZip
      const JSZipLib = await this._loadJSZip();
      if (!JSZipLib) {
        alert('JSZip 库加载失败，无法创建压缩包。请检查网络后重试。');
        return;
      }

      const zip = new JSZipLib();

      // 每条协议生成一个 JSON 文件加入 ZIP
      for (const entry of logs) {
        const exportData = this._buildExportEntry(entry);
        const jsonStr = JSON.stringify(exportData, null, 2);
        const fileName = this._buildLogFileName(entry);
        zip.file(fileName, jsonStr);
      }

      // 生成 ZIP 并下载
      const blob = await zip.generateAsync({ type: 'blob' });
      const finalName = zipName.endsWith('.zip') ? zipName : zipName + '.zip';
      await this._saveFile(blob, finalName);

      // 下载完成后自动取消勾选
      this._selectedLogIds.clear();
      this.updateLogList();
    }

    // ========================================
    // 发送 Tab（任务 10）
    // ========================================

    /** 创建发送 Tab 内容区：命令输入 + JSON 输入 + 发送按钮 + 提示 */
    _createSendTab() {
      const container = document.createElement('div');
      container.className = 'xyzw-tab-content';

      const form = document.createElement('div');
      form.className = 'xyzw-send-form';

      // 命令名称输入框（任务 10.1）
      const cmdLabel = document.createElement('div');
      cmdLabel.className = 'xyzw-input-label';
      cmdLabel.textContent = '命令名称 (cmd)';
      form.appendChild(cmdLabel);

      this._sendCmdInput = document.createElement('input');
      this._sendCmdInput.className = 'xyzw-input';
      this._sendCmdInput.type = 'text';
      this._sendCmdInput.placeholder = '例如: ItemService.openBox';
      form.appendChild(this._sendCmdInput);

      // JSON 消息体输入框（任务 10.1）
      const bodyLabel = document.createElement('div');
      bodyLabel.className = 'xyzw-input-label';
      bodyLabel.textContent = '消息体 (JSON)';
      form.appendChild(bodyLabel);

      this._sendBodyInput = document.createElement('textarea');
      this._sendBodyInput.className = 'xyzw-input xyzw-textarea';
      this._sendBodyInput.placeholder = '{"key": "value"}';
      form.appendChild(this._sendBodyInput);

      // 发送按钮（任务 10.2）
      const sendBtn = document.createElement('button');
      sendBtn.className = 'xyzw-btn xyzw-btn-primary';
      sendBtn.textContent = '发送';
      sendBtn.style.alignSelf = 'flex-start';
      sendBtn.addEventListener('click', () => {
        this._handleSend();
      });
      form.appendChild(sendBtn);

      // 提示信息区域（任务 10.3）
      this._sendMsgEl = document.createElement('div');
      this._sendMsgEl.className = 'xyzw-send-msg';
      form.appendChild(this._sendMsgEl);

      container.appendChild(form);
      return container;
    }

    /**
     * 处理发送按钮点击
     * 任务 10.2 + 10.3：校验输入 → 调用 messageSender → 显示结果
     */
    _handleSend() {
      // 清除之前的提示
      this._showSendMsg('', '');

      const cmd = this._sendCmdInput.value.trim();
      const bodyStr = this._sendBodyInput.value.trim();

      // 校验命令名称非空（任务 10.3）
      if (!cmd) {
        this._showSendMsg('请输入命令名称', 'error');
        return;
      }

      // 校验 JSON 格式合法（任务 10.3）
      let body;
      try {
        body = JSON.parse(bodyStr || '{}');
      } catch (e) {
        this._showSendMsg('JSON 格式不合法: ' + e.message, 'error');
        return;
      }

      // 调用 messageSender 发送（任务 10.2）
      const success = this._messageSender.send(cmd, body);
      if (success) {
        this._showSendMsg('发送成功 ✓', 'success');
      } else {
        this._showSendMsg('发送失败，WebSocket 连接不可用', 'error');
      }
    }

    /**
     * 显示发送结果提示
     * @param {string} text - 提示文本
     * @param {'error'|'success'|''} type - 提示类型
     */
    _showSendMsg(text, type) {
      if (!this._sendMsgEl) return;
      this._sendMsgEl.textContent = text;
      this._sendMsgEl.className = 'xyzw-send-msg';
      if (type === 'error') {
        this._sendMsgEl.classList.add('xyzw-send-msg-error');
      } else if (type === 'success') {
        this._sendMsgEl.classList.add('xyzw-send-msg-success');
      }
    }

    // ========================================
    // 字典 Tab
    // ========================================

    /** 创建字典 Tab 内容区：统计信息 + 导入/导出/同步/清空 + 字典列表 */
    _createDictTab() {
      const container = document.createElement('div');
      container.className = 'xyzw-tab-content';

      const wrapper = document.createElement('div');
      wrapper.className = 'xyzw-settings';

      // 字典统计信息
      this._dictInfoEl = document.createElement('div');
      this._dictInfoEl.className = 'xyzw-dict-info';
      this._dictInfoEl.textContent = '当前字典: 0 条协议记录';
      wrapper.appendChild(this._dictInfoEl);

      // 操作按钮行
      const btnRow = document.createElement('div');
      btnRow.className = 'xyzw-dict-btn-row';

      // 导入按钮 + 隐藏文件选择器
      this._dictFileInput = document.createElement('input');
      this._dictFileInput.type = 'file';
      this._dictFileInput.style.display = 'none';
      this._dictFileInput.addEventListener('change', (e) => {
        this._handleDictImport(e);
      });
      btnRow.appendChild(this._dictFileInput);

      const importBtn = document.createElement('button');
      importBtn.className = 'xyzw-btn xyzw-btn-primary';
      importBtn.textContent = '导入字典';
      importBtn.addEventListener('click', () => {
        this._dictFileInput.click();
      });
      btnRow.appendChild(importBtn);

      const exportBtn = document.createElement('button');
      exportBtn.className = 'xyzw-btn xyzw-btn-secondary';
      exportBtn.textContent = '导出字典';
      exportBtn.addEventListener('click', () => {
        this._handleDictExport();
      });
      btnRow.appendChild(exportBtn);

      const syncBtn = document.createElement('button');
      syncBtn.className = 'xyzw-btn xyzw-btn-secondary';
      syncBtn.textContent = '同步备注';
      syncBtn.addEventListener('click', () => {
        this._handleSyncNotesToDict();
      });
      btnRow.appendChild(syncBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'xyzw-btn xyzw-btn-secondary';
      clearBtn.style.color = '#fa8c16';
      clearBtn.textContent = '清空字典';
      clearBtn.addEventListener('click', () => {
        const size = this._configManager.getDictSize();
        if (size === 0) {
          this._showDictMsg('字典已为空', 'error');
          return;
        }
        if (confirm('确定清空全部 ' + size + ' 条字典数据？')) {
          this._configManager.clearDictionary();
          this._updateDictUI();
          this._renderDictList();
          this._showDictMsg('字典已清空', 'success');
        }
      });
      btnRow.appendChild(clearBtn);

      wrapper.appendChild(btnRow);

      // 操作提示信息
      this._dictMsgEl = document.createElement('div');
      this._dictMsgEl.className = 'xyzw-dict-msg';
      wrapper.appendChild(this._dictMsgEl);

      // 字典列表标题（可折叠）
      const listHeader = document.createElement('div');
      listHeader.className = 'xyzw-dict-list-header';
      listHeader.textContent = '▶ 字典列表';
      let listExpanded = false;

      // 字典列表容器
      this._dictListEl = document.createElement('div');
      this._dictListEl.className = 'xyzw-dict-list';
      this._dictListEl.style.display = 'none';

      listHeader.addEventListener('click', () => {
        listExpanded = !listExpanded;
        this._dictListEl.style.display = listExpanded ? 'block' : 'none';
        listHeader.textContent = (listExpanded ? '▼' : '▶') + ' 字典列表';
        if (listExpanded) {
          this._renderDictList();
        }
      });

      wrapper.appendChild(listHeader);
      wrapper.appendChild(this._dictListEl);

      container.appendChild(wrapper);

      // 初始刷新统计
      this._updateDictUI();

      return container;
    }

    // ========================================
    // 设置 Tab（任务 11）
    // ========================================

    /** 创建设置 Tab 内容区：黑名单管理 */
    _createSettingsTab() {
          const container = document.createElement('div');
          container.className = 'xyzw-tab-content';

          const settings = document.createElement('div');
          settings.className = 'xyzw-settings';

          // ====== 下载路径配置区域 ======
          const dlSection = document.createElement('div');
          dlSection.className = 'xyzw-settings-section';

          const dlTitle = document.createElement('div');
          dlTitle.className = 'xyzw-settings-title';
          dlTitle.textContent = '📂 下载路径';
          dlSection.appendChild(dlTitle);

          // 当前路径显示
          this._dlPathDisplayEl = document.createElement('div');
          this._dlPathDisplayEl.style.cssText = 'font-size:12px;color:#999;margin-bottom:8px;';
          this._updateDlPathDisplay();
          dlSection.appendChild(this._dlPathDisplayEl);

          // 按钮行
          const dlBtnRow = document.createElement('div');
          dlBtnRow.className = 'xyzw-dict-btn-row';

          // 选择目录按钮（仅支持 showDirectoryPicker 的浏览器可用）
          const dlSelectBtn = document.createElement('button');
          dlSelectBtn.className = 'xyzw-btn xyzw-btn-primary';
          dlSelectBtn.textContent = '选择目录';
          dlSelectBtn.addEventListener('click', async () => {
            try {
              // 调试：检测 API 支持情况
              const info = [
                'showDirectoryPicker: ' + typeof window.showDirectoryPicker,
                'showSaveFilePicker: ' + typeof window.showSaveFilePicker,
                'showOpenFilePicker: ' + typeof window.showOpenFilePicker,
                'FileSystemHandle: ' + typeof window.FileSystemHandle,
                'userAgent: ' + navigator.userAgent
              ];
              if (typeof window.showDirectoryPicker !== 'function') {
                alert('环境检测结果:\n\n' + info.join('\n') + '\n\n该环境不支持 showDirectoryPicker');
                return;
              }
              const dirHandle = await window.showDirectoryPicker();
              this._downloadDirHandle = dirHandle;
              this._updateDlPathDisplay();
              this._showDlPathMsg('目录已选择', 'success');
            } catch (e) {
              alert('选择目录出错:\n\n类型: ' + e.name + '\n信息: ' + e.message + '\n\n' + e.stack);
              if (e.name !== 'AbortError') {
                this._showDlPathMsg('选择目录失败: ' + e.message, 'error');
              }
            }
          });
          dlBtnRow.appendChild(dlSelectBtn);

          // 重置按钮（恢复为系统默认下载路径）
          const dlResetBtn = document.createElement('button');
          dlResetBtn.className = 'xyzw-btn xyzw-btn-secondary';
          dlResetBtn.textContent = '使用默认';
          dlResetBtn.addEventListener('click', () => {
            this._downloadDirHandle = null;
            this._updateDlPathDisplay();
            this._showDlPathMsg('已恢复默认下载路径', 'success');
          });
          dlBtnRow.appendChild(dlResetBtn);

          dlSection.appendChild(dlBtnRow);

          // 路径操作提示
          this._dlPathMsgEl = document.createElement('div');
          this._dlPathMsgEl.className = 'xyzw-dict-msg';
          dlSection.appendChild(this._dlPathMsgEl);

          settings.appendChild(dlSection);

          // ====== 配置导出/导入区域 ======
          const cfgSection = document.createElement('div');
          cfgSection.className = 'xyzw-settings-section';

          const cfgTitle = document.createElement('div');
          cfgTitle.className = 'xyzw-settings-title';
          cfgTitle.textContent = '📦 配置导出/导入';
          cfgSection.appendChild(cfgTitle);

          // 说明文字
          const cfgDesc = document.createElement('div');
          cfgDesc.style.cssText = 'font-size:12px;color:#999;margin-bottom:8px;';
          cfgDesc.textContent = '导出/导入完整配置（包含黑名单、备注、字典）';
          cfgSection.appendChild(cfgDesc);

          // 按钮行
          const cfgBtnRow = document.createElement('div');
          cfgBtnRow.className = 'xyzw-dict-btn-row';

          // 导出配置按钮
          const exportCfgBtn = document.createElement('button');
          exportCfgBtn.className = 'xyzw-btn xyzw-btn-primary';
          exportCfgBtn.textContent = '导出配置';
          exportCfgBtn.addEventListener('click', () => {
            this._handleExportConfig();
          });
          cfgBtnRow.appendChild(exportCfgBtn);

          // 导入配置按钮 + 隐藏文件选择器
          this._cfgFileInput = document.createElement('input');
          this._cfgFileInput.type = 'file';
          this._cfgFileInput.style.display = 'none';
          this._cfgFileInput.addEventListener('change', (e) => {
            this._handleImportConfig(e);
          });
          cfgBtnRow.appendChild(this._cfgFileInput);

          const importCfgBtn = document.createElement('button');
          importCfgBtn.className = 'xyzw-btn xyzw-btn-secondary';
          importCfgBtn.textContent = '导入配置';
          importCfgBtn.addEventListener('click', () => {
            this._cfgFileInput.click();
          });
          cfgBtnRow.appendChild(importCfgBtn);

          cfgSection.appendChild(cfgBtnRow);

          // 配置操作提示信息
          this._cfgMsgEl = document.createElement('div');
          this._cfgMsgEl.className = 'xyzw-dict-msg';
          cfgSection.appendChild(this._cfgMsgEl);

          settings.appendChild(cfgSection);

          // ====== 黑名单管理区域 ======
          const blSection = document.createElement('div');
          blSection.className = 'xyzw-settings-section';

          const blTitle = document.createElement('div');
          blTitle.className = 'xyzw-settings-title';
          blTitle.textContent = '🚫 黑名单管理';
          blSection.appendChild(blTitle);

          // 输入行：输入框 + 添加按钮
          const inputRow = document.createElement('div');
          inputRow.className = 'xyzw-blacklist-input-row';

          this._blacklistInput = document.createElement('input');
          this._blacklistInput.className = 'xyzw-input';
          this._blacklistInput.type = 'text';
          this._blacklistInput.placeholder = '输入要屏蔽的命令名称';
          inputRow.appendChild(this._blacklistInput);

          const addBtn = document.createElement('button');
          addBtn.className = 'xyzw-btn xyzw-btn-primary';
          addBtn.textContent = '添加';
          addBtn.addEventListener('click', () => {
            this._handleAddBlacklist();
          });
          inputRow.appendChild(addBtn);

          blSection.appendChild(inputRow);

          // 黑名单列表容器
          this._blacklistListEl = document.createElement('div');
          this._blacklistListEl.className = 'xyzw-blacklist-list';
          blSection.appendChild(this._blacklistListEl);

          settings.appendChild(blSection);

          container.appendChild(settings);

          // 初始渲染黑名单列表
          this._renderBlacklist();

          return container;
        }



    /** 处理添加黑名单项 */
    _handleAddBlacklist() {
      const cmd = this._blacklistInput.value.trim();
      if (!cmd) return;

      // 调用 configManager 添加（已自动持久化，任务 11.3）
      this._configManager.addToBlacklist(cmd);
      this._blacklistInput.value = '';
      this._renderBlacklist();

      // 黑名单变更后刷新日志列表（过滤新增的黑名单项）
      this.updateLogList();
    }

    /**
     * 处理删除黑名单项
     * @param {string} cmd - 要删除的命令名称
     */
    _handleRemoveBlacklist(cmd) {
      // 调用 configManager 删除（已自动持久化，任务 11.3）
      this._configManager.removeFromBlacklist(cmd);
      this._renderBlacklist();

      // 黑名单变更后刷新日志列表
      this.updateLogList();
    }

    /** 重新渲染黑名单列表 */
    _renderBlacklist() {
      if (!this._blacklistListEl) return;
      this._blacklistListEl.textContent = '';

      const blacklist = this._configManager.getBlacklist();
      blacklist.forEach(cmd => {
        const item = document.createElement('div');
        item.className = 'xyzw-blacklist-item';

        const nameEl = document.createElement('span');
        nameEl.className = 'xyzw-blacklist-item-name';
        nameEl.textContent = cmd;
        item.appendChild(nameEl);

        const delBtn = document.createElement('button');
        delBtn.className = 'xyzw-blacklist-del-btn';
        delBtn.textContent = '删除';
        delBtn.addEventListener('click', () => {
          this._handleRemoveBlacklist(cmd);
        });
        item.appendChild(delBtn);

        this._blacklistListEl.appendChild(item);
      });
    }

    // ========================================
    // 配置导出/导入方法
    // ========================================

    /**
     * 导出完整配置为 JSON 文件
     * 包含黑名单、备注、字典
     */
    _handleExportConfig() {
      const jsonStr = this._configManager.exportConfigJson();
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const timeTag = this._buildBeijingTimeTag();
      const fileName = '咸鱼监控_配置_' + timeTag + '.json';
      this._saveFile(blob, fileName).then(ok => {
        if (ok) this._showCfgMsg('配置已导出', 'success');
      }).catch(e => {
        console.error('[MonitorUI] 导出配置失败:', e);
        this._showCfgMsg('导出失败', 'error');
      });
    }

    /**
     * 处理配置文件导入
     * @param {Event} e - file input change 事件
     */
    _handleImportConfig(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      // 重置 input，允许重复选择同一文件
      this._cfgFileInput.value = '';

      const reader = new FileReader();
      reader.onload = () => {
        const result = this._configManager.importConfig(reader.result, false);
        if (result.error) {
          this._showCfgMsg('导入失败: ' + result.error, 'error');
          return;
        }
        const parts = [];
        if (result.blacklistAdded > 0) parts.push('黑名单+' + result.blacklistAdded);
        if (result.notesAdded > 0) parts.push('备注+' + result.notesAdded);
        if (result.notesUpdated > 0) parts.push('备注更新' + result.notesUpdated);
        if (result.dictAdded > 0) parts.push('字典+' + result.dictAdded);
        if (result.dictUpdated > 0) parts.push('字典更新' + result.dictUpdated);

        if (parts.length === 0) {
          this._showCfgMsg('导入完成，无新增数据（已存在）', 'success');
        } else {
          this._showCfgMsg('导入完成: ' + parts.join(', '), 'success');
        }

        // 刷新相关 UI
        this._renderBlacklist();
        this.updateLogList();
      };
      reader.onerror = () => {
        this._showCfgMsg('读取文件失败', 'error');
      };
      reader.readAsText(file, 'UTF-8');
    }

    /**
     * 显示配置操作结果提示
     * @param {string} text - 提示文本
     * @param {'success'|'error'} type - 提示类型
     */
    _showCfgMsg(text, type) {
      if (!this._cfgMsgEl) return;
      this._cfgMsgEl.textContent = text;
      this._cfgMsgEl.className = 'xyzw-dict-msg';
      if (type === 'error') {
        this._cfgMsgEl.classList.add('xyzw-dict-msg-error');
      } else if (type === 'success') {
        this._cfgMsgEl.classList.add('xyzw-dict-msg-success');
      }
      clearTimeout(this._cfgMsgTimer);
      this._cfgMsgTimer = setTimeout(() => {
        if (this._cfgMsgEl) this._cfgMsgEl.textContent = '';
      }, 3000);
    }

    /**
     * 显示下载路径保存提示信息
     * @param {string} text - 提示文本
     * @param {'success'|'error'} type - 提示类型
     */
    _showDlPathMsg(text, type) {
      if (!this._dlPathMsgEl) return;
      this._dlPathMsgEl.textContent = text;
      this._dlPathMsgEl.className = 'xyzw-dict-msg';
      if (type === 'error') {
        this._dlPathMsgEl.classList.add('xyzw-dict-msg-error');
      } else if (type === 'success') {
        this._dlPathMsgEl.classList.add('xyzw-dict-msg-success');
      }
      clearTimeout(this._dlPathMsgTimer);
      this._dlPathMsgTimer = setTimeout(() => {
        if (this._dlPathMsgEl) this._dlPathMsgEl.textContent = '';
      }, 3000);
    }

    /**
     * 更新下载路径显示文本
     */
    _updateDlPathDisplay() {
      if (!this._dlPathDisplayEl) return;
      if (this._downloadDirHandle) {
        this._dlPathDisplayEl.textContent = '当前目录: ' + this._downloadDirHandle.name;
      } else {
        this._dlPathDisplayEl.textContent = '当前: 系统默认下载路径';
      }
    }

    // ========================================
    // 字典管理方法
    // ========================================

    /**
     * 处理字典文件导入
     * @param {Event} e - file input change 事件
     */
    _handleDictImport(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      // 重置 input，允许重复选择同一文件
      this._dictFileInput.value = '';

      const reader = new FileReader();
      reader.onload = () => {
        const result = DictionaryParser.parse(file.name, reader.result);
        if (result.error) {
          this._showDictMsg('导入失败: ' + result.error, 'error');
          return;
        }
        const count = Object.keys(result.entries).length;
        if (count === 0) {
          this._showDictMsg('文件中未找到有效的字典条目', 'error');
          return;
        }
        const stats = this._configManager.importDictionary(result.entries, false);
        this._showDictMsg(
          '导入完成: 新增 ' + stats.added + ' 条' +
          (stats.updated > 0 ? ', 更新 ' + stats.updated + ' 条' : '') +
          (stats.skipped > 0 ? ', 跳过 ' + stats.skipped + ' 条(已存在)' : ''),
          'success'
        );
        this._updateDictUI();
      };
      reader.onerror = () => {
        this._showDictMsg('读取文件失败', 'error');
      };
      reader.readAsText(file, 'UTF-8');
    }

    /**
     * 导出字典为 JSON 文件
     */
    _handleDictExport() {
      const dict = this._configManager.getDictionary();
      const count = Object.keys(dict).length;
      if (count === 0) {
        this._showDictMsg('字典为空，无内容可导出', 'error');
        return;
      }

      const jsonStr = this._configManager.exportDictionaryJson();
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const timeTag = this._buildBeijingTimeTag();
      const fileName = '咸鱼监控_字典_' + timeTag + '.json';
      this._saveFile(blob, fileName).then(ok => {
        if (ok) this._showDictMsg('已导出 ' + count + ' 条字典数据', 'success');
      }).catch(e => {
        console.error('[MonitorUI] 导出字典失败:', e);
        this._showDictMsg('导出失败', 'error');
      });
    }

    /**
     * 将用户备注同步到字典库
     */
    _handleSyncNotesToDict() {
      const noteCount = this._configManager.getNotedCmds().length;
      if (noteCount === 0) {
        this._showDictMsg('暂无备注可同步', 'error');
        return;
      }
      const stats = this._configManager.syncNotesToDictionary(false);
      this._showDictMsg(
        '同步完成: 新增 ' + stats.added + ' 条' +
        (stats.updated > 0 ? ', 更新 ' + stats.updated + ' 条' : '') +
        (stats.added === 0 && stats.updated === 0 ? ' (所有备注已在字典中)' : ''),
        'success'
      );
      this._updateDictUI();
    }

    /**
     * 显示字典操作结果提示
     * @param {string} text - 提示文本
     * @param {'success'|'error'} type - 提示类型
     */
    _showDictMsg(text, type) {
      if (!this._dictMsgEl) return;
      this._dictMsgEl.textContent = text;
      this._dictMsgEl.className = 'xyzw-dict-msg';
      if (type === 'error') {
        this._dictMsgEl.classList.add('xyzw-dict-msg-error');
      } else if (type === 'success') {
        this._dictMsgEl.classList.add('xyzw-dict-msg-success');
      }
      // 3秒后自动清除提示
      clearTimeout(this._dictMsgTimer);
      this._dictMsgTimer = setTimeout(() => {
        if (this._dictMsgEl) this._dictMsgEl.textContent = '';
      }, 3000);
    }

    /**
     * 更新字典统计信息显示
     */
    _updateDictUI() {
      if (this._dictInfoEl) {
        const size = this._configManager.getDictSize();
        this._dictInfoEl.textContent = '当前字典: ' + size + ' 条协议记录';
      }
    }

    /**
     * 渲染字典列表内容
     */
    _renderDictList() {
      if (!this._dictListEl) return;
      this._dictListEl.textContent = '';

      const dict = this._configManager.getDictionary();
      const entries = Object.entries(dict);

      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'xyzw-dict-empty';
        empty.textContent = '字典为空，请导入字典文件或同步备注';
        this._dictListEl.appendChild(empty);
        return;
      }

      // 按 cmd 字母排序
      entries.sort((a, b) => a[0].localeCompare(b[0]));

      for (const [cmd, note] of entries) {
        const item = document.createElement('div');
        item.className = 'xyzw-dict-item';

        const cmdEl = document.createElement('span');
        cmdEl.className = 'xyzw-dict-item-cmd';
        cmdEl.textContent = cmd;
        item.appendChild(cmdEl);

        const noteEl = document.createElement('span');
        noteEl.className = 'xyzw-dict-item-note';
        noteEl.textContent = note;
        item.appendChild(noteEl);

        const delBtn = document.createElement('button');
        delBtn.className = 'xyzw-blacklist-del-btn';
        delBtn.textContent = '删除';
        delBtn.addEventListener('click', () => {
          this._configManager.removeDictEntry(cmd);
          this._renderDictList();
          this._updateDictUI();
        });
        item.appendChild(delBtn);

        this._dictListEl.appendChild(item);
      }
    }

    // ========================================
    // 文件下载工具方法
    // ========================================

    /**
     * 通用文件保存方法
     * 优先使用 File System Access API（showSaveFilePicker）让用户选择保存路径
     * 不支持时回退到 <a download> 方式
     * @param {Blob} blob - 要保存的文件数据
     * @param {string} fileName - 建议的文件名
     * @returns {Promise<boolean>} 是否保存成功
     */
    async _saveFile(blob, fileName) {
      // 使用 <a download> 触发下载（兼容所有环境，包括 Android WebView）
      const url = URL.createObjectURL(blob);
      try {
        const body = document.body || document.documentElement;
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
        return true;
      } catch (e) {
        // 极端情况回退
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return true;
      }
    }

    /**
     * 动态加载 JSZip 库（CDN）
     * 加载成功后缓存到 _global._JSZip，避免重复加载
     * @returns {Promise<object|null>} JSZip 构造函数，加载失败返回 null
     */
    async _loadJSZip() {
      // 已加载过直接返回
      if (_global._JSZip) return _global._JSZip;
      if (typeof JSZip !== 'undefined') { _global._JSZip = JSZip; return JSZip; }

      return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
        script.onload = () => {
          if (typeof JSZip !== 'undefined') {
            _global._JSZip = JSZip;
            resolve(JSZip);
          } else {
            console.error('[MonitorUI] JSZip 加载后未找到全局变量');
            resolve(null);
          }
        };
        script.onerror = () => {
          console.error('[MonitorUI] JSZip CDN 加载失败');
          resolve(null);
        };
        (document.head || document.documentElement).appendChild(script);
      });
    }

    /**
     * 构造单条日志的导出数据对象
     * 抽取公共逻辑，避免在多个下载方法中重复
     * @param {object} entry - 日志条目
     * @returns {object} 导出数据
     */
    _buildExportEntry(entry) {
      const note = entry.cmd ? this._configManager.getNote(entry.cmd) : null;
      const dictNote = entry.cmd ? this._configManager.getDictEntry(entry.cmd) : null;
      const analysis = ProtocolAnalyzer.analyze(entry.cmd, entry.body, entry.direction, note, dictNote);
      return {
        direction: entry.direction === 'send' ? '请求' : '响应',
        cmd: entry.cmd,
        note: note || null,
        dictNote: dictNote || null,
        analysis: analysis || null,
        timestamp: entry.timestamp,
        time: this._formatTime(entry.timestamp),
        duration: entry.duration || 0,
        rawSize: entry.rawSize || 0,
        seq: entry.seq,
        ack: entry.ack,
        body: entry.body
      };
    }

    /**
     * 构造单条日志的文件名
     * @param {object} entry - 日志条目
     * @returns {string} 文件名（不含路径）
     */
    _buildLogFileName(entry) {
      const dirTag = entry.direction === 'send' ? '请求' : '响应';
      const dlTime = this._buildBeijingTimeTag();
      return '咸鱼监控_' + (entry.cmd || 'unknown') + '_' + dirTag + '_' + dlTime + '.json';
    }

    /**
     * 生成北京时间标签，格式：YYYY-MM-DD_HH-mm-ss
     * @returns {string}
     */
    _buildBeijingTimeTag() {
      const now = new Date();
      // 转为北京时间（UTC+8）
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const bj = new Date(utc + 8 * 3600000);
      const y = bj.getFullYear();
      const M = String(bj.getMonth() + 1).padStart(2, '0');
      const d = String(bj.getDate()).padStart(2, '0');
      const h = String(bj.getHours()).padStart(2, '0');
      const m = String(bj.getMinutes()).padStart(2, '0');
      const s = String(bj.getSeconds()).padStart(2, '0');
      return y + '-' + M + '-' + d + '_' + h + '-' + m + '-' + s;
    }

    // ========================================
    // 内部工具方法
    // ========================================

    /** 切换面板显示/隐藏 */
    _togglePanel() {
      this._panelVisible = !this._panelVisible;
      if (this._panelVisible) {
        this._panel.classList.add('xyzw-visible');
        // 打开面板时隐藏悬浮按钮
        if (this._floatBtn) {
          this._floatBtn.style.display = 'none';
        }
        // 打开面板时刷新日志列表
        this.updateLogList();
      } else {
        this._panel.classList.remove('xyzw-visible');
        // 关闭面板时重置展开状态
        this._expandedLogId = null;
        // 关闭面板时显示悬浮按钮
        if (this._floatBtn) {
          this._floatBtn.style.display = 'flex';
        }
      }
    }

    /**
     * 切换 Tab 页
     * @param {string} tabKey - 'monitor' | 'send' | 'settings'
     */
    _switchTab(tabKey) {
      this._activeTab = tabKey;

      // 更新 Tab 按钮样式
      Object.keys(this._tabBtns).forEach(key => {
        if (key === tabKey) {
          this._tabBtns[key].classList.add('xyzw-active');
        } else {
          this._tabBtns[key].classList.remove('xyzw-active');
        }
      });

      // 更新 Tab 内容区显示
      Object.keys(this._tabContents).forEach(key => {
        if (key === tabKey) {
          this._tabContents[key].classList.add('xyzw-visible');
        } else {
          this._tabContents[key].classList.remove('xyzw-visible');
        }
      });

      // 切换到监控 Tab 时刷新日志
      if (tabKey === 'monitor') {
        this.updateLogList();
      }
      // 切换到设置 Tab 时刷新黑名单
      if (tabKey === 'settings') {
        this._renderBlacklist();
      }
      // 切换到字典 Tab 时刷新字典统计
      if (tabKey === 'dict') {
        this._updateDictUI();
      }
    }

    /**
     * 格式化时间戳为 HH:MM:SS
     * @param {number} timestamp - Date.now() 时间戳
     * @returns {string} 格式化后的时间字符串
     */
    _formatTime(timestamp) {
      if (!timestamp) return '--:--:--';
      const d = new Date(timestamp);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return hh + ':' + mm + ':' + ss;
    }

    /** 启动定时刷新（每秒更新计数，面板可见时刷新日志） */
    _startAutoRefresh() {
      this._refreshTimer = setInterval(() => {
        // 始终更新计数徽章
        this.updateCount(this._logManager.getCount());
        // 面板可见且在监控 Tab 时刷新日志列表
        if (this._panelVisible && this._activeTab === 'monitor') {
          this.updateLogList();
        }
      }, 1000);
    }
  }


  // ============================================================
  // 脚本入口 - 初始化与启动
  // ============================================================

  let configManager, logManager, wsHook;

  // ---- 第一阶段：安装 WebSocket Hook ----
  try {
    configManager = new ConfigManager();
    logManager = new LogManager();

    wsHook = new WebSocketHook((direction, data) => {
      try {
        const message = MessageParser.parse(data, direction);
        if (message) {
          logManager.add(message);
          // 记录到协议分析器，用于请求-响应关联
          ProtocolAnalyzer.recordEntry(message);
        }
      } catch (e) {
        console.error('[咸鱼之王监控] 消息解析异常:', e);
      }
    });

    wsHook.install();
    console.log('[咸鱼之王监控] WebSocket Hook 已安装');
  } catch (e) {
    console.error('[咸鱼之王监控] Hook 安装失败:', e);
    // Hook 失败不阻塞 UI 创建，监控功能降级但界面仍可用
  }

  // ---- 第二阶段：DOM 就绪后创建 UI ----
  let _uiInitialized = false;

  function initUI() {
    if (_uiInitialized) return;
    if (!document.body) return;
    _uiInitialized = true;

    try {
      const messageSender = new MessageSender(() => wsHook ? wsHook.getActiveWebSocket() : null);
      const ui = new MonitorUI({
        logManager,
        configManager,
        messageSender,
        wsHook
      });
      ui.create();
      console.log('[咸鱼之王监控] UI 初始化完成');
    } catch (e) {
      console.error('[咸鱼之王监控] UI 初始化失败:', e);
    }
  }

  // 与 xh.js 完全一致的初始化入口
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI, { once: true });
  } else {
    // DOM 已就绪（AI之王管理器通常走这个分支）
    initUI();
  }

})();
