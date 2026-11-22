// Backup export size guard. The OOM path was: build the base64 JSON for every
// attachment, then check the limit. These assertions pin the check to BEFORE any
// encoding work, using a Blob subclass whose `size` is huge but which allocates
// nothing, so the test stays fast.
import assert from "node:assert/strict";
import {
  encodeBackup,
  backupZip,
  estimateBackupBytes,
  assertBackupFits
} from "../src/cloud/backup-codec.js";

let passed = 0;
function ok(value, label) {
  assert.ok(value, label);
  passed += 1;
}

const MiB = 1024 * 1024;

class SizedBlob extends Blob {
  constructor(size) {
    super([new Uint8Array(1)]);
    this._size = size;
  }
  get size() {
    return this._size;
  }
}

try {
  /* ------------------------------------------------------------- estimates */
  ok(estimateBackupBytes({}) === 64 * 1024, "an empty snapshot costs only the JSON allowance");
  const small = estimateBackupBytes({ file: new Blob(["123456"]) });
  ok(small > 64 * 1024 && small < 64 * 1024 + 32, "a 6-byte blob projects to 8 base64 bytes");
  const big = estimateBackupBytes({ a: new SizedBlob(300 * MiB), b: new SizedBlob(300 * MiB) });
  ok(big > 512 * MiB, "blob sizes accumulate across the snapshot");
  ok(
    estimateBackupBytes({ a: {}, b: { c: 1 } }) > 0,
    "plain JSON objects estimate without throwing"
  );

  /* --------------------------------------------------------- pre-flight gate */
  assert.throws(
    () => assertBackupFits({ file: new SizedBlob(600 * MiB) }),
    /512 MiB/,
    "an oversized snapshot is rejected up front"
  );
  ok(true, "the error names the 512 MiB limit");
  assert.throws(
    () => assertBackupFits({ file: new SizedBlob(400 * MiB) }),
    /512 MiB/,
    "base64 inflation counts toward the limit (400 MiB of binary > 512 MiB)"
  );
  ok(true, "base64 expansion is accounted for, not just raw bytes");
  assertBackupFits({ file: new SizedBlob(300 * MiB) });
  ok(true, "a snapshot that still fits is allowed through");

  /* ------------------------------------ guard fires before any encode work */
  let progressed = false;
  await assert.rejects(
    encodeBackup(
      { file: new SizedBlob(600 * MiB) },
      {
        onProgress: () => {
          progressed = true;
        }
      }
    ),
    /512 MiB/
  );
  ok(!progressed, "encoding never starts for an oversized snapshot");

  await assert.rejects(backupZip({ file: new SizedBlob(600 * MiB) }), /512 MiB/);
  ok(true, "the ZIP path fails the same way before compression");

  /* -------------------------------------------------- in-limit round trip */
  const encoded = await encodeBackup({ file: new Blob(["hello"]) });
  ok(encoded.file.$ariseBlob === 1, "small blobs still encode losslessly");
  ok(Buffer.from(encoded.file.data, "base64").toString() === "hello", "blob bytes round trip");

  // Circular input must report clearly rather than hang the walk.
  const loop = {};
  loop.self = loop;
  assert.throws(() => estimateBackupBytes(loop), /circular/);
  ok(true, "a circular snapshot is reported, not walked forever");

  console.log("\nBackup size guard: " + passed + " assertions passed.");
} catch (error) {
  console.error("\nBackup size guard FAILED:");
  console.error(error);
  process.exitCode = 1;
}
