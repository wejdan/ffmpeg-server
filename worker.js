const { workerData, parentPort } = require("worker_threads");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
require("dotenv").config();

// Set the path to the ffmpeg binary if necessary
const ffmpegPath = process.env.FFMPEG_PATH;
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

// Set the path to the ffmpeg binary if necessary
//ffmpeg.setFfmpegPath("C:\\ffmpeg\\bin\\ffmpeg.exe");

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
        console.log("Spawned Ffpeg with command: " + commandLine);
      })
      .on("progress", (progress) => {
        console.log(`Progress: ${progress.percent}% done`);
        parentPort.postMessage({ progress: progress.percent });
      })
      .on("end", () => {
        console.log("MP4 file created at:", outputMp4Path);
        resolve(outputMp4Path);
      })
      .on("error", (err) => {
        console.error("Error processing HLS:", err);
        reject(new Error("Failed to process HLS"));
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
