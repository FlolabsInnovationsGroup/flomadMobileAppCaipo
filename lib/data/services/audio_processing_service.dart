import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:ffmpeg_kit_flutter_full_gpl/ffmpeg_kit.dart';

/// Holds hash + filePath for each audio chunk.
class ChunkInfo {
  final String hash;
  final String filePath;

  ChunkInfo({required this.hash, required this.filePath});
}

/// Trims silence and splits audio into fixed-duration OPUS chunks, returning their hashes and paths.
class AudioProcessingService {
  /// Preprocesses [inputPath] by trimming silence and splitting into
  /// `<chunkDurationSec>`-second OPUS files.
  Future<List<ChunkInfo>> preprocessAndChunk({
    required String inputPath,
    int chunkDurationSec = 30,
  }) async {
    // 1️⃣ Trim leading/trailing silence
    final trimmedPath = '\${inputPath}_trimmed.opus';
    final trimCommand =
        '-i "$inputPath" -af silenceremove=start_periods=1:start_silence=0:start_threshold=-50dB ' 
        'silenceremove=start_periods=1:start_silence=0:start_threshold=-50dB ' 
        '"$trimmedPath"';
    final trimSession = await FFmpegKit.execute(trimCommand);
    final trimReturnCode = await trimSession.getReturnCode();
    if (!trimReturnCode.isValueSuccess) {
      throw Exception('FFmpeg silence trimming failed: \$trimReturnCode');
    }

    // 2️⃣ Split into fixed-length segments
    final chunks = <ChunkInfo>[];
    var index = 0;
    while (true) {
      final chunkPath = '\${inputPath}_chunk_\$index.opus';
      final segmentCommand =
          '-i "$trimmedPath" -c copy -map 0 -segment_time \$chunkDurationSec ' 
          '-f segment "$chunkPath"';
      final session = await FFmpegKit.execute(segmentCommand);
      final returnCode = await session.getReturnCode();
      if (!returnCode.isValueSuccess) break;

      final file = File(chunkPath);
      if (!await file.exists()) break;

      // 3️⃣ Compute SHA-256 hash for deduplication
      final data = await file.readAsBytes();
      final hash = sha256.convert(data).toString();

      chunks.add(ChunkInfo(hash: hash, filePath: chunkPath));
      index++;
    }

    return chunks;
  }
}
