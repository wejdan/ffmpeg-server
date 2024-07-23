const express = require("express");
const { Worker } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const m3u8Parser = require("m3u8-parser");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const WebSocket = require("ws");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const WEBSOCKET_URL = process.env.WEBSOCKET_URL;
const BASE_URL = process.env.BASE_URL;
let clients = {};
// Middleware to parse JSON requests
app.use(bodyParser.json());

// Serve the downloaded files statically
app.use("/downloads", express.static(path.join(__dirname, "downloads")));

// Define a simple route
app.get("/", (req, res) => {
  res.send("Hello, World!");
});

// Define a route to handle remuxing
app.post("/remux", async (req, res, next) => {
  try {
    const { url, quality, name, videoId } = req.body;
    const outputFileName = name || `${uuidv4()}.mp4`;
    const outputPath = path.join(__dirname, "downloads", outputFileName);
    const masterPlaylistContent = await axios
      .get(url)
      .then((response) => response.data);
    const selectedStreams = await selectStreams(
      masterPlaylistContent,
      quality,
      url
    );

    console.log("selectedStreams", selectedStreams);
    if (!selectedStreams) {
      return res
        .status(400)
        .send({ error: "Requested quality not found in the master playlist" });
    }
    // Create a WebSocket for this request
    const ws = new WebSocket(WEBSOCKET_URL);

    ws.on("open", async () => {
      // Create a worker thread for remuxing
      const worker = new Worker(path.join(__dirname, "worker.js"), {
        workerData: {
          videoUrl: selectedStreams.videoUrl,
          audioUrl: selectedStreams.audioUrl,
          outputPath,
        },
      });

      worker.on("message", (message) => {
        if (message.progress !== undefined) {
          // console.log("message.progress", message.progress);
          if (clients[videoId]) {
            clients[videoId].send(
              JSON.stringify({ progress: message.progress })
            );
          }
        } else if (message.mp4Path) {
          const relativePath = path.relative(__dirname, message.mp4Path);
          const urlPath = `${BASE_URL}/${relativePath
            .split(path.sep)
            .join("/")}`;
          console.log("urlPath", urlPath);

          ws.send(JSON.stringify({ done: true, mp4Path: urlPath }));
          res.send({ mp4Path: urlPath });

          setTimeout(() => {
            fs.unlink(message.mp4Path, (err) => {
              if (err) {
                console.error(`Failed to delete file ${message.mp4Path}:`, err);
              } else {
                console.log(`File ${message.mp4Path} deleted`);
              }
            });
          }, 600000); // Delete file after 1 minute
        }
      });

      worker.on("error", (err) => {
        if (clients[videoId]) {
          clients[videoId].send(JSON.stringify({ error: err.message }));
        }
        res.status(500).send(err.message);
      });

      worker.on("exit", (code) => {
        if (code !== 0) {
          console.error(`Worker stopped with exit code ${code}`);
          if (clients[videoId]) {
            clients[videoId].send(
              JSON.stringify({ error: `Worker stopped with exit code ${code}` })
            );
          }
          res.status(500).send(`Worker stopped with exit code ${code}`);
        }
        if (clients[videoId]) {
          clients[videoId].close();
          delete clients[videoId];
        }
      });
    });
  } catch (error) {
    next(error);
  }
});

// Function to select video and audio streams based on quality
async function selectStreams(masterPlaylistContent, quality, baseUrl) {
  const parser = new m3u8Parser.Parser();
  parser.push(masterPlaylistContent);
  parser.end();
  console.log(masterPlaylistContent);
  const { playlists, mediaGroups } = parser.manifest;

  if (!playlists || playlists.length === 0) {
    // Handle the case where the provided URL is not a master playlist
    console.log("Provided URL is a single playlist");
    const videoUrl = new URL(baseUrl).href;
    return { videoUrl, audioUrl: null };
  }
  const [width, height] = quality.split("x").map(Number);
  const selectedPlaylist = playlists.find(
    (pl) =>
      pl.attributes.RESOLUTION &&
      pl.attributes.RESOLUTION.width === width &&
      pl.attributes.RESOLUTION.height === height
  );
  if (!selectedPlaylist) {
    throw new Error("Requested quality not found in the master playlist");
  }

  const videoUrl = new URL(selectedPlaylist.uri, baseUrl).href;
  const audioGroupId = selectedPlaylist.attributes.AUDIO;
  let audioUrl = null;

  if (audioGroupId && mediaGroups.AUDIO && mediaGroups.AUDIO[audioGroupId]) {
    const audioPlaylist = mediaGroups.AUDIO[audioGroupId];
    const audioUriKey = Object.keys(audioPlaylist).find((key) =>
      key.toLowerCase().includes("audio")
    );

    if (audioUriKey) {
      audioUrl = new URL(audioPlaylist[audioUriKey].uri, baseUrl).href;
    }
  }

  return { videoUrl, audioUrl };
}

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send({ error: err.message });
});
// Start the server

// Start the server and attach the WebSocket server to it
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  const urlParams = new URLSearchParams(req.url.slice(1));
  const videoId = urlParams.get("videoId");
  if (videoId) {
    clients[videoId] = ws;
    ws.on("close", () => {
      delete clients[videoId];
    });
  }
});
