import { TextDecoder, TextEncoder } from 'fast-text-encoding';

export type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type StructReadFn = (ds: DataStream, struct: object) => any;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type LenFn = (struct: object, ds: DataStream, def: StructRead) => any;

// https://github.com/Microsoft/TypeScript/issues/3496#issuecomment-128553540
/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type StructRead = string | StructReadFn | { get: StructReadFn } | ['[]', string, string | LenFn] | StructReadArray;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
// tslint:disable-next-line no-empty-interface
export interface StructReadArray extends Array<StructRead> {}

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type StructWriteFn = (ds: DataStream, field: string, struct: object) => void;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type StructWrite = string | StructWriteFn | { set: StructWriteFn } | StructWriteArray;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
// tslint:disable-next-line no-empty-interface
export interface StructWriteArray extends Array<StructWrite> {}

/**
 * Type endsWith '*' mean array.
 * Type endsWith '+' mean array | utf8 string with length encoded as Uint16 & write/read before the actual array | utf8 string.
 */
// prettier-ignore
export type Type =
    "Int8" | "Int16" | "Int32" | "Uint8" | "Uint16" | "Uint32" | "Float32" | "Float64" |
    "Int8*" | "Int16*" | "Int32*" | "Uint8*" | "Uint16*" | "Uint32*" | "Float32*" | "Float64*" |
    "Utf8WithLen";

// tslint:disable-next-line no-empty-interface
export interface TypeArr extends Array<Type | TypeArr> {}

/** [0] is object field's name to read from or write into.
 *  [1] is its type definition
 *  examples:
 *  ["num", "Int16"]
 *  ["greet", "Utf8+"]
 *  ["obj", [
 *      ["num", "Int8"],
 *      ["len", "Uint16"],
 *      ["greet", "Utf8"]]
 *  ]
 */
export type TypeDef1 = [string, Type | TypeDef];
// tslint:disable-next-line no-empty-interface
export interface TypeDef extends Array<TypeDef1> {}

/**
 * DataStream reads scalars, arrays and structs of data from an ArrayBuffer.
 * It's like a file-like DataView on steroids.
 *
 * @param {ArrayBuffer} arrayBuffer ArrayBuffer to read from.
 * @param {?Number} byteOffset Offset from arrayBuffer beginning for the DataStream.
 * @param {?Boolean} endianness DataStream.BIG_ENDIAN or DataStream.LITTLE_ENDIAN (the default).
 */
export default class DataStream {
    private _byteOffset: number;
    position = 0;
    private _buffer: ArrayBuffer;
    private _dataView: DataView;

    constructor(
        arrayBuffer?: ArrayBuffer | { buffer: ArrayBuffer; byteOffset: number; byteLength: number },
        byteOffset?: number,
        public endianness: boolean = DataStream.LITTLE_ENDIAN
    ) {
        this._byteOffset = byteOffset || 0;
        if (arrayBuffer instanceof ArrayBuffer) {
            this.buffer = arrayBuffer;
        } else if (typeof arrayBuffer === 'object') {
            this.dataView = arrayBuffer as any;
            if (byteOffset) {
                this._byteOffset += byteOffset;
            }
        } else {
            this.buffer = new ArrayBuffer(arrayBuffer || 1);
        }
    }

    /**
     * Big-endian const to use as default endianness.
     * @type {boolean}
     */
    static readonly BIG_ENDIAN = false;

    /**
     * Little-endian const to use as default endianness.
     * @type {boolean}
     */
    static readonly LITTLE_ENDIAN = true;

    /**
     * Whether to extend DataStream buffer when trying to write beyond its size.
     * If set, the buffer is reallocated to twice its current size until the
     * requested write fits the buffer.
     * @type {boolean}
     */
    private _dynamicSize = true;
    get dynamicSize(): boolean {
        return this._dynamicSize;
    }

    set dynamicSize(v: boolean) {
        if (!v) {
            this._trimAlloc();
        }
        this._dynamicSize = v;
    }

    /**
     * Virtual byte length of the DataStream backing buffer.
     * Updated to be max of original buffer size and last written size.
     * If dynamicSize is false is set to buffer size.
     * @type {number}
     */
    private _byteLength = 0;

    /**
     * Returns the byte length of the DataStream object.
     * @type {number}
     */
    get byteLength(): number {
        return this._byteLength - this._byteOffset;
    }

    /**
     * Set/get the backing ArrayBuffer of the DataStream object.
     * The setter updates the DataView to point to the new buffer.
     * @type {Object}
     */
    get buffer(): ArrayBuffer {
        this._trimAlloc();
        return this._buffer;
    }

    set buffer(v: ArrayBuffer) {
        this._buffer = v;
        this._dataView = new DataView(this._buffer, this._byteOffset);
        this._byteLength = this._buffer.byteLength;
    }

    /**
     * Set/get the byteOffset of the DataStream object.
     * The setter updates the DataView to point to the new byteOffset.
     * @type {number}
     */
    get byteOffset(): number {
        return this._byteOffset;
    }

    set byteOffset(v: number) {
        this._byteOffset = v;
        this._dataView = new DataView(this._buffer, this._byteOffset);
        this._byteLength = this._buffer.byteLength;
    }

    /**
     * Set/get the backing DataView of the DataStream object.
     * The setter updates the buffer and byteOffset to point to the DataView values.
     * @type get: DataView, set: {buffer: ArrayBuffer, byteOffset: number, byteLength: number}
     */
    get dataView(): DataView {
        return this._dataView;
    }

    set dataView(v: DataView) {
        this._byteOffset = v.byteOffset;
        this._buffer = v.buffer;
        this._dataView = new DataView(this._buffer, this._byteOffset);
        this._byteLength = this._byteOffset + v.byteLength;
    }

    bigEndian(): DataStream {
        this.endianness = DataStream.BIG_ENDIAN;
        return this;
    }
    /**
     * Internal function to resize the DataStream buffer when required.
     * @param {number} extra Number of bytes to add to the buffer allocation.
     * @return {null}
     */
    private _realloc(extra: number) {
        if (!this._dynamicSize) {
            return;
        }
        const req = this._byteOffset + this.position + extra;
        let blen = this._buffer.byteLength;
        if (req <= blen) {
            if (req > this._byteLength) {
                this._byteLength = req;
            }
            return;
        }
        if (blen < 1) {
            blen = 1;
        }
        while (req > blen) {
            blen *= 2;
        }
        const buf = new ArrayBuffer(blen);
        const src = new Uint8Array(this._buffer);
        const dst = new Uint8Array(buf, 0, src.length);
        dst.set(src);
        this.buffer = buf;
        this._byteLength = req;
    }

    /**
     * Internal function to trim the DataStream buffer when required.
     * Used for stripping out the extra bytes from the backing buffer when
     * the virtual byteLength is smaller than the buffer byteLength (happens after
     * growing the buffer with writes and not filling the extra space completely).
     * @return {null}
     */
    private _trimAlloc(): void {
        if (this._byteLength === this._buffer.byteLength) {
            return;
        }
        const buf = new ArrayBuffer(this._byteLength);
        const dst = new Uint8Array(buf);
        const src = new Uint8Array(this._buffer, 0, dst.length);
        dst.set(src);
        this.buffer = buf;
    }

    /**
     * Sets the DataStream read/write position to given position.
     * Clamps between 0 and DataStream length.
     * @param {number} pos Position to seek to.
     * @return {null}
     */
    seek(pos) {
        const npos = Math.max(0, Math.min(this.byteLength, pos));
        this.position = isNaN(npos) || !isFinite(npos) ? 0 : npos;
    }

    /**
     * Returns true if the DataStream seek pointer is at the end of buffer and
     * there's no more data to read.
     * @return {boolean} True if the seek pointer is at the end of the buffer.
     */
    isEof() {
        return this.position >= this.byteLength;
    }

    /**
     * Maps a Uint8Array into the DataStream buffer.
     *
     * Nice for quickly reading in data.
     *
     * @param {number} length Number of elements to map.
     * @return {Object} Uint8Array to the DataStream backing buffer.
     */
    mapUint8Array(length: number): Uint8Array {
        this._realloc(length);
        const arr = new Uint8Array(this._buffer, this.byteOffset + this.position, length);
        this.position += length;
        return arr;
    }

    /**
   Reads a 16-bit int from the DataStream with the offset
  
   @param {number} offset The offset.
   @return {number} The read number.
   */
    readShort(offset: number): number {
        this.seek(offset);
        return this.readInt16();
    }

    /**
   Reads an 8-bit int from the DataStream with the offset.
  
   @param {number} offset The offset.
   @return {number} The read number.
   */
    readByte(offset: number): number {
        this.seek(offset);
        return this.readInt8();
    }

    /**
   Read UCS-2 string of desired length and offset from the DataStream.
  
   @param {number} offset The offset.
   @param {number} length The length of the string to read.
   @return {string} The read string.
   */
    readStringAt(offset, length) {
        this.seek(offset);
        return this.readUCS2String(length);
    }

    /**
     * Reads an Int32Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Int32Array.
     */
    readInt32Array(length: number, e?: boolean): Int32Array {
        length = length == null ? this.byteLength - this.position / 4 : length;
        const arr = new Int32Array(length);
        DataStream.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads an Int16Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Int16Array.
     */
    readInt16Array(length: number, e?: boolean): Int16Array {
        length = length == null ? this.byteLength - this.position / 2 : length;
        const arr = new Int16Array(length);
        DataStream.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads an Int8Array of desired length from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @return {Object} The read Int8Array.
     */
    readInt8Array(length: number): Int8Array {
        length = length == null ? this.byteLength - this.position : length;
        const arr = new Int8Array(length);
        DataStream.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Uint32Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Uint32Array.
     */
    readUint32Array(length: number, e?: boolean): Uint32Array {
        length = length == null ? this.byteLength - this.position / 4 : length;
        const arr = new Uint32Array(length);
        DataStream.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Uint16Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Uint16Array.
     */
    readUint16Array(length: number, e?: boolean): Uint16Array {
        length = length == null ? this.byteLength - this.position / 2 : length;
        const arr = new Uint16Array(length);
        DataStream.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Uint8Array of desired length from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @return {Object} The read Uint8Array.
     */
    readUint8Array(length: number): Uint8Array {
        length = length == null ? this.byteLength - this.position : length;
        const arr = new Uint8Array(length);
        DataStream.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Float64Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Float64Array.
     */
    readFloat64Array(length: number, e?: boolean): Float64Array {
        length = length == null ? this.byteLength - this.position / 8 : length;
        const arr = new Float64Array(length);
        DataStream.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Float32Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Float32Array.
     */
    readFloat32Array(length: number, e?: boolean): Float32Array {
        length = length == null ? this.byteLength - this.position / 4 : length;
        const arr = new Float32Array(length);
        DataStream.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a 32-bit int from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readInt32(e?: boolean): number {
        const v = this._dataView.getInt32(this.position, e == null ? this.endianness : e);
        this.position += 4;
        return v;
    }

    /**
     * Reads a 16-bit int from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readInt16(e?: boolean): number {
        const v = this._dataView.getInt16(this.position, e == null ? this.endianness : e);
        this.position += 2;
        return v;
    }

    /**
     * Reads an 8-bit int from the DataStream.
     *
     * @return {number} The read number.
     */
    readInt8(): number {
        const v = this._dataView.getInt8(this.position);
        this.position += 1;
        return v;
    }

    /**
   Reads a 32-bit int from the DataStream with the offset.
  
   @param {number} offset The offset.
   @return {number} The read number.
   */
    readInt(offset: number): number {
        this.seek(offset);
        return this.readInt32();
    }

    /**
     * Reads a 32-bit unsigned int from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readUint32(e?: boolean): number {
        const v = this._dataView.getUint32(this.position, e == null ? this.endianness : e);
        this.position += 4;
        return v;
    }

    /**
     * Reads a 16-bit unsigned int from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readUint16(e?: boolean): number {
        const v = this._dataView.getUint16(this.position, e == null ? this.endianness : e);
        this.position += 2;
        return v;
    }

    /**
     * Reads an 8-bit unsigned int from the DataStream.
     *
     * @return {number} The read number.
     */
    readUint8(): number {
        const v = this._dataView.getUint8(this.position);
        this.position += 1;
        return v;
    }

    /**
     * Reads a 32-bit float from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readFloat32(e?: boolean): number {
        const v = this._dataView.getFloat32(this.position, e == null ? this.endianness : e);
        this.position += 4;
        return v;
    }

    /**
     * Reads a 64-bit float from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readFloat64(e?: boolean): number {
        const v = this._dataView.getFloat64(this.position, e == null ? this.endianness : e);
        this.position += 8;
        return v;
    }

    /**
     * Native endianness. Either DataStream.BIG_ENDIAN or DataStream.LITTLE_ENDIAN
     * depending on the platform endianness.
     *
     * @type {boolean}
     */
    static readonly endianness: boolean = new Int8Array(new Int16Array([1]).buffer)[0] > 0;

    /**
     * Copies byteLength bytes from the src buffer at srcOffset to the
     * dst buffer at dstOffset.
     *
     * @param {Object} dst Destination ArrayBuffer to write to.
     * @param {number} dstOffset Offset to the destination ArrayBuffer.
     * @param {Object} src Source ArrayBuffer to read from.
     * @param {number} srcOffset Offset to the source ArrayBuffer.
     * @param {number} byteLength Number of bytes to copy.
     */
    static memcpy(dst: ArrayBufferLike, dstOffset: number, src: ArrayBuffer, srcOffset: number, byteLength: number) {
        const dstU8 = new Uint8Array(dst, dstOffset, byteLength);
        const srcU8 = new Uint8Array(src, srcOffset, byteLength);
        dstU8.set(srcU8);
    }

    /**
     * Converts array to native endianness in-place.
     *
     * @param {Object} array Typed array to convert.
     * @param {boolean} arrayIsLittleEndian True if the data in the array is
     * little-endian. Set false for big-endian.
     * @return {Object} The converted typed array.
     */
    static arrayToNative(array, arrayIsLittleEndian: boolean) {
        if (arrayIsLittleEndian === this.endianness) {
            return array;
        } else {
            return this.flipArrayEndianness(array); // ???
        }
    }

    /**
     * Converts native endianness array to desired endianness in-place.
     *
     * @param {Object} array Typed array to convert.
     * @param {boolean} littleEndian True if the converted array should be
     * little-endian. Set false for big-endian.
     * @return {Object} The converted typed array.
     */
    static nativeToEndian(array: TypedArray, littleEndian: boolean) {
        if (this.endianness === littleEndian) {
            return array;
        } else {
            return this.flipArrayEndianness(array);
        }
    }

    /**
     * Flips typed array endianness in-place.
     *
     * @param {Object} array Typed array to flip.
     * @return {Object} The converted typed array.
     */
    static flipArrayEndianness(array: TypedArray) {
        const u8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < array.byteLength; i += array.BYTES_PER_ELEMENT) {
            for (
                // tslint:disable-next-line one-variable-per-declaration
                let j = i + array.BYTES_PER_ELEMENT - 1, k = i;
                j > k;
                j--, k++
            ) {
                const tmp = u8[k];
                u8[k] = u8[j];
                u8[j] = tmp;
            }
        }
        return array;
    }

    /**
     * Creates an array from an array of character codes.
     * Uses String.fromCharCode in chunks for memory efficiency and then concatenates
     * the resulting string chunks.
     *
     * @param {TypedArray} array Array of character codes.
     * @return {string} String created from the character codes.
     */
    static createStringFromArray(array: TypedArray) {
        const chunkSize = 0x8000;
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(String.fromCharCode.apply(null, array.subarray(i, i + chunkSize)));
        }
        return chunks.join('');
    }

    /**
     * Seek position where DataStream#readStruct ran into a problem.
     * Useful for debugging struct parsing.
     *
     * @type {number}
     */
    failurePosition = 0;

    /**
     * Reads a struct of data from the DataStream. The struct is defined as
     * a flat array of [name, type]-pairs. See the example below:
     *
     * ds.readStruct([
     * 'headerTag', 'uint32', // Uint32 in DataStream endianness.
     * 'headerTag2', 'uint32be', // Big-endian Uint32.
     * 'headerTag3', 'uint32le', // Little-endian Uint32.
     * 'array', ['[]', 'uint32', 16], // Uint32Array of length 16.
     * 'array2Length', 'uint32',
     * 'array2', ['[]', 'uint32', 'array2Length'] // Uint32Array of length array2Length
     * ]);
     *
     * The possible values for the type are as follows:
     *
     * // Number types
     *
     * // Unsuffixed number types use DataStream endianness.
     * // To explicitly specify endianness, suffix the type with
     * // 'le' for little-endian or 'be' for big-endian,
     * // e.g. 'int32be' for big-endian int32.
     *
     * 'uint8' -- 8-bit unsigned int
     * 'uint16' -- 16-bit unsigned int
     * 'uint32' -- 32-bit unsigned int
     * 'int8' -- 8-bit int
     * 'int16' -- 16-bit int
     * 'int32' -- 32-bit int
     * 'float32' -- 32-bit float
     * 'float64' -- 64-bit float
     *
     * // String types
     * 'cstring' -- ASCII string terminated by a zero byte.
     * 'string:N' -- ASCII string of length N, where N is a literal integer.
     * 'string:variableName' -- ASCII string of length $variableName,
     * where 'variableName' is a previously parsed number in the current struct.
     * 'string,CHARSET:N' -- String of byteLength N encoded with given CHARSET.
     * 'u16string:N' -- UCS-2 string of length N in DataStream endianness.
     * 'u16stringle:N' -- UCS-2 string of length N in little-endian.
     * 'u16stringbe:N' -- UCS-2 string of length N in big-endian.
     *
     * // Complex types
     * [name, type, name_2, type_2, ..., name_N, type_N] -- Struct
     * function(dataStream, struct) {} -- Callback function to read and return data.
     * {get: function(dataStream, struct) {},
     *  set: function(dataStream, struct) {}}
     * -- Getter/setter functions to read and return data, handy for using the same
     * struct definition for reading and writing structs.
     * ['[]', type, length] -- Array of given type and length. The length can be either
     * a number, a string that references a previously-read
     * field, or a callback function(struct, dataStream, type){}.
     * If length is '*', reads in as many elements as it can.
     *
     * @param {Object} structDefinition Struct definition object.
     * @return {Object} The read struct. Null if failed to read struct.
     *
     * @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct
     */
    readStruct(structDefinition: StructRead[]): object {
        const struct = {};
        let t: StructRead;
        let v;
        const p = this.position;
        for (let i = 0; i < structDefinition.length; i += 2) {
            t = structDefinition[i + 1];
            v = this.readType(t, struct);
            if (v == null) {
                if (this.failurePosition === 0) {
                    this.failurePosition = this.position;
                }
                this.position = p;
                return null;
            }
            struct[structDefinition[i] as string] = v;
        }
        return struct;
    }

    /** ex:
     * const def = [
     *      ["obj", [["num", "Int8"],
     *               ["greet", "Utf8WithLen"],
     *               ["a1", "Int16*"]]
     *      ],
     *      ["a2", "Uint16*"]
     *  ];
     *  const o = {obj: {
     *          num: 5,
     *          greet: "Xin chào",
     *          a1: [-3, 0, 4, 9, 0x7FFF],
     *      },
     *      a2: [3, 0, 4, 9, 0xFFFF]
     *  });
     *  ds.write(def, o);
     *  expect: new DataStream(ds.buffer).read(def) deepEqual o
     */
    read(def: TypeDef): object {
        const o = {};
        let d: TypeDef1;
        for (d of def) {
            const v = d[0];
            const t = d[1];
            if (typeof t === 'string') {
                if (t.endsWith('*')) {
                    const len = this.readUint16();
                    o[v] = this['read' + t.substr(0, t.length - 1) + 'Array'](len);
                } else {
                    o[v] = this['read' + t]();
                }
            } else {
                o[v] = this.read(t);
            }
        }
        return o;
    }

    /**
     * Read UCS-2 string of desired length and endianness from the DataStream.
     *
     * @param {number} length The length of the string to read.
     * @param {boolean} endianness The endianness of the string data in the DataStream.
     * @return {string} The read string.
     */
    readUCS2String(length: number, endianness?: boolean): string {
        return DataStream.createStringFromArray(this.readUint16Array(length, endianness));
    }

    /**
     * Read a string of desired length and encoding from the DataStream.
     *
     * @param {number} length The length of the string to read in bytes.
     * @param {?string} encoding The encoding of the string data in the DataStream.
     * Defaults to ASCII.
     * @return {string} The read string.
     */
    readString(length: number, encoding?: string): string {
        if (encoding == null || encoding === 'ASCII') {
            return DataStream.createStringFromArray(this.mapUint8Array(length == null ? this.byteLength - this.position : length));
        } else {
            return new TextDecoder(encoding).decode(this.mapUint8Array(length));
        }
    }

    /** readUint16 into `len` then read `len` Uint8 then parse into the result utf8 string */
    readUtf8WithLen(): string {
        const len = this.readUint16();
        return new TextDecoder('utf-8').decode(this.mapUint8Array(len));
    }

    /**
     * Read null-terminated string of desired length from the DataStream. Truncates
     * the returned string so that the null byte is not a part of it.
     *
     * @param {?number} length The length of the string to read.
     * @return {string} The read string.
     */
    readCString(length?: number): string {
        const blen = this.byteLength - this.position;
        const u8 = new Uint8Array(this._buffer, this._byteOffset + this.position);
        let len = blen;
        if (length != null) {
            len = Math.min(length, blen);
        }
        let i = 0;
        for (; i < len && u8[i] !== 0; i++) {
            // find first zero byte
        }
        const s = DataStream.createStringFromArray(this.mapUint8Array(i));
        if (length != null) {
            this.position += len - i;
        } else if (i !== blen) {
            this.position += 1; // trailing zero if not at end of buffer
        }
        return s;
    }

    /**
     * Reads an object of type t from the DataStream, passing struct as the thus-far
     * read struct to possible callbacks that refer to it. Used by readStruct for
     * reading in the values, so the type is one of the readStruct types.
     *
     * @param {Object} t Type of the object to read.
     * @param {?Object} struct Struct to refer to when resolving length references
     * and for calling callbacks.
     * @return {?Object} Returns the object on successful read, null on unsuccessful.
     */
    readType(t, struct: object): any {
        if (typeof t === 'function') {
            return t(this, struct);
        } else if (typeof t === 'object' && !(t instanceof Array)) {
            return t.get(this, struct);
        } else if (t instanceof Array && t.length !== 3) {
            return this.readStruct(t as StructRead[]);
        }
        let v = null;
        let lengthOverride = null;
        let charset = 'ASCII';
        const pos = this.position;
        if (typeof t === 'string' && /:/.test(t)) {
            const tp = t.split(':');
            t = tp[0];
            const len = tp[1];

            // allow length to be previously parsed variable
            // e.g. 'string:fieldLength', if `fieldLength` has been parsed previously.
            // else, assume literal integer e.g., 'string:4'
            lengthOverride = parseInt(struct[len] != null ? struct[len] : len, 10);
        }
        if (typeof t === 'string' && /,/.test(t)) {
            const tp = t.split(',');
            t = tp[0];
            charset = tp[1];
        }
        switch (t) {
            case 'uint8':
                v = this.readUint8();
                break;
            case 'int8':
                v = this.readInt8();
                break;

            case 'uint16':
                v = this.readUint16(this.endianness);
                break;
            case 'int16':
                v = this.readInt16(this.endianness);
                break;
            case 'uint32':
                v = this.readUint32(this.endianness);
                break;
            case 'int32':
                v = this.readInt32(this.endianness);
                break;
            case 'float32':
                v = this.readFloat32(this.endianness);
                break;
            case 'float64':
                v = this.readFloat64(this.endianness);
                break;

            case 'uint16be':
                v = this.readUint16(DataStream.BIG_ENDIAN);
                break;
            case 'int16be':
                v = this.readInt16(DataStream.BIG_ENDIAN);
                break;
            case 'uint32be':
                v = this.readUint32(DataStream.BIG_ENDIAN);
                break;
            case 'int32be':
                v = this.readInt32(DataStream.BIG_ENDIAN);
                break;
            case 'float32be':
                v = this.readFloat32(DataStream.BIG_ENDIAN);
                break;
            case 'float64be':
                v = this.readFloat64(DataStream.BIG_ENDIAN);
                break;

            case 'uint16le':
                v = this.readUint16(DataStream.LITTLE_ENDIAN);
                break;
            case 'int16le':
                v = this.readInt16(DataStream.LITTLE_ENDIAN);
                break;
            case 'uint32le':
                v = this.readUint32(DataStream.LITTLE_ENDIAN);
                break;
            case 'int32le':
                v = this.readInt32(DataStream.LITTLE_ENDIAN);
                break;
            case 'float32le':
                v = this.readFloat32(DataStream.LITTLE_ENDIAN);
                break;
            case 'float64le':
                v = this.readFloat64(DataStream.LITTLE_ENDIAN);
                break;

            case 'cstring':
                v = this.readCString(lengthOverride);
                break;

            case 'string':
                v = this.readString(lengthOverride, charset);
                break;

            case 'u16string':
                v = this.readUCS2String(lengthOverride, this.endianness);
                break;

            case 'u16stringle':
                v = this.readUCS2String(lengthOverride, DataStream.LITTLE_ENDIAN);
                break;

            case 'u16stringbe':
                v = this.readUCS2String(lengthOverride, DataStream.BIG_ENDIAN);
                break;

            default:
                if (t.length === 3) {
                    const ta = t[1] as string;
                    const len = t[2];
                    let length = 0;
                    if (typeof len === 'function') {
                        length = len(struct, this, t);
                    } else if (typeof len === 'string' && struct[len] != null) {
                        length = parseInt(struct[len], 10);
                    } else {
                        length = parseInt(len as string, 10);
                    }
                    if (typeof ta === 'string') {
                        const tap = ta.replace(/(le|be)$/, '');
                        let endianness = null;
                        if (/le$/.test(ta)) {
                            endianness = DataStream.LITTLE_ENDIAN;
                        } else if (/be$/.test(ta)) {
                            endianness = DataStream.BIG_ENDIAN;
                        }
                        if (len === '*') {
                            length = null;
                        }
                        switch (tap) {
                            case 'uint8':
                                v = this.readUint8Array(length);
                                break;
                            case 'uint16':
                                v = this.readUint16Array(length, endianness);
                                break;
                            case 'uint32':
                                v = this.readUint32Array(length, endianness);
                                break;
                            case 'int8':
                                v = this.readInt8Array(length);
                                break;
                            case 'int16':
                                v = this.readInt16Array(length, endianness);
                                break;
                            case 'int32':
                                v = this.readInt32Array(length, endianness);
                                break;
                            case 'float32':
                                v = this.readFloat32Array(length, endianness);
                                break;
                            case 'float64':
                                v = this.readFloat64Array(length, endianness);
                                break;
                            case 'cstring':
                            case 'utf16string':
                            case 'string':
                                if (length == null) {
                                    v = [];
                                    while (!this.isEof()) {
                                        const u = this.readType(ta, struct);
                                        if (u == null) break;
                                        v.push(u);
                                    }
                                } else {
                                    v = new Array(length);
                                    for (let i = 0; i < length; i++) {
                                        v[i] = this.readType(ta, struct);
                                    }
                                }
                                break;
                        }
                    } else {
                        if (len === '*') {
                            v = [];
                            while (true) {
                                const p = this.position;
                                try {
                                    const o = this.readType(ta, struct);
                                    if (o == null) {
                                        this.position = p;
                                        break;
                                    }
                                    v.push(o);
                                } catch (e) {
                                    this.position = p;
                                    break;
                                }
                            }
                        } else {
                            v = new Array(length);
                            for (let i = 0; i < length; i++) {
                                const u = this.readType(ta, struct);
                                if (u == null) return null;
                                v[i] = u;
                            }
                        }
                    }
                    break;
                }
        }
        if (lengthOverride != null) {
            this.position = pos + lengthOverride;
        }
        return v;
    }
}
