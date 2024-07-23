const { workerData, parentPort } = require("worker_threads");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");

// Set the path to the ffmpeg binary if necessary
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

const { videoUrl, audioUrl, outputPath } = workerData;

console.log("workerData", workerData);

async function remuxHLS(videoUrl, audioUrl, outputMp4Path) {
  return new Promise((resolve, reject) => {
    const ffmpegCommand = ffmpeg();

    ffmpegCommand.input(videoUrl);

    if (audioUrl) {
      ffmpegCommand.input(audioUrl);
    }

    ffmpegCommand
      .outputOptions("-c copy")
      .output(outputMp4Path)
      .on("start", (commandLine) => {
        console.log("Spawned Ffmpeg with command: " + commandLine);
      })
      .on("progress", (progress) => {
        console.log(`Progress: ${progress.percent}% done`);
        parentPort.postMessage({ progress: progress.percent });
      })
      .on("end", () => {
        console.log("MP4 file created at:", outputMp4Path);
        resolve(outputMp4Path);
      })
      .on("error", (err, stdout, stderr) => {
        console.error("Error processing HLS:", err.message);
        console.error("ffmpeg stdout:", stdout);
        console.error("ffmpeg stderr:", stderr);
        reject(new Error("Failed to process bHS"));
      })
      .on("stderr", (stderrLine) => {
        console.error("ffmpeg stderr:", stderrLine);
      })
      .run();
  });
}

remuxHLS(videoUrl, audioUrl, outputPath)
  .then((mp4Path) => {
    parentPort.postMessage({ mp4Path });
  })
  .catch((error) => {
    parentPort.postMessage({ error: error.message });
  });
