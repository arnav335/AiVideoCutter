# 🎬 AI Video Cutter

**An AI-powered video editing tool that automates the removal of unnecessary pauses and redundant speech from recorded videos.**

AI Video Cutter aims to reduce the time and effort spent on manual video editing by combining speech recognition, AI-based transcription cleaning, and automated video processing.

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [How It Works](#-how-it-works)
- [Technologies Used](#-technologies-used)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Running the Project](#-running-the-project)
- [Project Structure](#-project-structure)
- [Limitations](#-limitations)

---

## 💡 Overview

During video production, a considerable amount of time is spent manually removing long pauses, repeated sentences, filler words, and unnecessary portions of recorded speech.

AI Video Cutter attempts to automate this process.

The application analyses the audio of a recorded video, generates word-level transcriptions, identifies long pauses, and uses an AI language model to clean the transcription. The processed information is then used to generate an edited video.

---

## ✨ Features

- **Automated Transcription:** Converts spoken audio into text with word-level timestamps.
- **Long Pause Removal:** Detects and removes unnecessary gaps between spoken words.
- **AI-Based Transcription Cleaning:** Uses an LLM to identify redundant elements in the transcription.
- **Automated Video Rendering:** Uses the processed transcription to determine which portions should be retained.
- **Multiple Media Formats:** Supports the project's configured MP4, MP3, and WAV processing workflows.

---

## ⚙️ How It Works

The application follows a multi-stage processing pipeline:

1. **Input:** The user provides a video for processing.
2. **Video Formatting:** The input video is converted into a compatible format.
3. **Transcription:** Speechmatics generates a word-level transcription with timestamps.
4. **Pause Removal:** Long pauses are identified and removed from the video.
5. **Re-transcription:** The modified video is transcribed again to obtain updated timestamps.
6. **AI Cleaning:** GPT-OSS-8B, accessed through Groq Cloud, cleans the transcription.
7. **Video Rendering:** The processed transcription is used to determine the portions to retain.
8. **Output:** The final edited video is generated.

---

## 🛠️ Technologies Used

| Technology | Purpose |
|---|---|
| Node.js | Application runtime |
| JavaScript (ES Modules) | Application development |
| Speechmatics API | Speech-to-text transcription |
| Groq Cloud | Access to the GPT-OSS-8B language model |
| FFmpeg | Audio and video processing |
| dotenv | Environment variable management |

---

## 📋 Prerequisites

Before running the project, make sure you have:

- [Node.js](https://nodejs.org/) installed.
- [FFmpeg](https://ffmpeg.org/) installed and accessible through your system PATH.
- [Git](https://git-scm.com/install/) installed.
- A Speechmatics API key.
- A Groq API key.

### Verify installations

Open a terminal and execute:

```bash
node --version
npm --version
ffmpeg -version
```

If all three commands return version information, the corresponding tools are accessible.

---

## 📥 Installation

### 1. Clone the repository

```bash
git clone https://github.com/arnav335/AiVideoCutter
```

### 2. Navigate to the project directory

```bash
cd AiVideoCutter
```

### 3. Install dependencies

```bash
npm install
```

This installs the dependencies specified in `package.json`:

- `@speechmatics/batch-client`
- `dotenv`

---

## 🔑 Configuration

The project uses environment variables to store API credentials.

Create a `.env` file in the root directory of the project.

Add your API credentials using the variable names expected by the source code.

For example:

```env
SPEECHMATICS_API_KEY=your_speechmatics_api_key
GROQ_API_KEY=your_groq_api_key
```

---

## ▶️ Running the Project

After installing the dependencies and configuring the environment variables:

### 1. Place the input video

Place the video you want to process in the project's `input` directory.

### 2. Execute the application

From the root directory, run:

```bash
node src/index.js
```

### 3. Wait for processing

The application will execute its configured processing pipeline, including:

- Video formatting
- Audio extraction and transcription
- Long pause removal
- Re-transcription
- AI-based transcription cleaning
- Final video rendering

### 4. Access the output

Once processing is complete, check the `output` directory for the generated files.

---

## 📁 Project Structure

The project follows a modular structure:

```text
AiVideoCutter/
│
├── input/
│   └── Input videos
│
├── output/
│   └── Generated files and transcriptions
│
├── src/
│   ├── functions/
│   │   ├── transcribe.js
│   │   └── Other processing functions
│   │
│   ├── utils/
│   │   └── convertToWav.js
│   │
│   └── index.js
│
├── .env
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

*Note: The structure above is a simplified representation. Additional source files may exist in the actual project.*

---

## ⚠️ Limitations

- Transcription accuracy depends on audio quality and the speech recognition service.
- Background noise, overlapping speech, and unclear pronunciation can affect transcription.
- AI-based transcription cleaning may occasionally remove or modify content incorrectly.
- Processing time depends on video duration, file size, internet connectivity, and API response times.
- API access may be subject to service-specific usage limits.

---

## 🚀 Future Improvements

- Improved identification of redundant speech.
- More precise editing using sentence-level context.
- A graphical user interface.

---

## 👨‍💻 Author

Developed as an exploration of artificial intelligence, speech recognition, and automated multimedia processing.

**AI Video Cutter — Making video editing less manual.**
- Arnav