import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();

async function processFile(file, segmentDuration, segmentSize, bitrate, resolution, format) {
    try {
        if (!ffmpeg.loaded) {
            await ffmpeg.load();
            // await ffmpeg.load({
            //     coreURL: "/assets/core/package/dist/umd/ffmpeg-core.js",
            // });
            console.log('ffmpeg succesfully loaded')
        }

        const url = URL.createObjectURL(file);

        await ffmpeg.writeFile(file.name, await fetchFile(url));

        ffmpeg.on("progress", ({ progress, time }) => {
            document.getElementById('progress').innerHTML = `${progress * 100} %, time: ${time / 1000000} s`;
        });

        const segmentNames = []
        let metadata = { duration: 0, codec: '', resolution: { width: 0, height: 0 }, bitrate: '' };

        let type = file.type
        if (format) {
            // Ensure the format is supported and has defined options
            if (!contentType[format]) {
                throw new Error(`Unsupported format: ${format}`);
            }

            type = contentType[format].type;
        }

        ffmpeg.on("log", ({ message }) => {
            let match
            // Segment Name
            if (match = message.match(/\[segment @ [^\]]+\] Opening '([^']+)' for writing/)) {
                segmentNames.push(match[1]);
            }
            // Duration
            if ((match = message.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2}),/))) {
                const hours = parseInt(match[1], 10);
                const minutes = parseInt(match[2], 10);
                const seconds = parseInt(match[3], 10) + parseFloat('0.' + match[4]);
                metadata.duration = hours * 3600 + minutes * 60 + seconds;
            }
            // Video Stream (Codec & Resolution)
            if ((match = message.match(/Video: ([^\s]+) .*, (\d+)x(\d+)/))) {
                metadata.codec = match[1];
                metadata.resolution.width = parseInt(match[2], 10);
                metadata.resolution.height = parseInt(match[3], 10);
            }
            // Bitrate
            if ((match = message.match(/bitrate: (\d+) kb\/s/))) {
                metadata.bitrate = `${match[1]}kbps`;
            }
        })

        // Prepare and exec the FFmpeg command
        let command = await getCommand(file, segmentDuration, segmentSize, bitrate, resolution, format)
        await ffmpeg.exec(command);

        let playlist = null
        const streamConfig = {
            title: "Video Title",
            totalDuration: 0,
            'content-type': "video/mp4",
            segments: []
        }

        const segments = []

        if (segmentDuration || segmentSize) {
            let start = 0
            playlist = {
                title: "Video Title",
                totalDuration: 0,
                'content-type': "video/mp4",
            }

            if (format === 'hls') {
                playlist.src = await ffmpeg.readFile(`${file.name.replace(`.${fileExtension}`, `.m3u8`)}`);
                playlist.src = new Blob([src.buffer], { type })
            } else {
                playlist.segments = []
            }

            // Handle the segmented files
            for (let i = 0; i < segmentNames.length; i++) {
                let src = await ffmpeg.readFile(segmentNames[i]);
                src = new Blob([src.buffer], { type })

                const { duration, size } = await getMediaInfo(src);
                const end = start + duration

                segments.push({ name: segmentNames[i], src, ...metadata, duration, size, start, end })

                if (format !== 'hls') {
                    streamConfig.segments.push({ name: segmentNames[i], src: `/${segmentNames[i]}`, ...metadata, duration, size, start, end })
                }

                start += duration

                ffmpeg.deleteFile(segmentNames[i]);
            }

            playlist.totalDuration = start

            streamConfig.totalDuration = start

        } else {
            let src = await ffmpeg.readFile(file.name);
            file.src = new Blob([src.buffer], { type })
        }

        ffmpeg.deleteFile(file.name);

        return { file, streamConfig, playlist, segments }
    } catch (error) {
        console.log(error)
    }
}

async function getMediaInfo(file) {
    const url = URL.createObjectURL(file);
    const mediaElement = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    mediaElement.src = url;

    return new Promise((resolve) => {
        mediaElement.addEventListener('loadedmetadata', () => {
            const duration = mediaElement.duration;
            const size = file.size;
            URL.revokeObjectURL(url);
            resolve({ duration, size });
        });
        mediaElement.load();
    });
}

async function getCommand(file, segmentDuration, segmentSize, bitrate, resolution, format) {
    let command = ['-i', file.name, '-c', 'copy'];
    const fileExtension = getFormat(file)

    // Determine the format from the file type if not explicitly provided
    if (format) {
        // Ensure the format is supported and has defined options
        if (!contentType[format]) {
            throw new Error(`Unsupported format: ${format}`);
        }

        // Set video codecs from contentType
        if (contentType[format].videoCodec)
            command.push('-c:v', contentType[format].videoCodec);

        // Set audio codecs from contentType
        if (contentType[format].audioCodec)
            command.push('-c:a', contentType[format].audioCodec);

        // Format and codec-specific options
        if (contentType[format].extraOptions && contentType[format].extraOptions.length) {
            command = command.concat(contentType[format].extraOptions);
        }
    }

    // Bitrate adjustment (for video)
    if (bitrate) {
        command.push('-b:v', bitrate);
    }

    // Resolution adjustment
    if (resolution) {
        command.push('-s', resolution);
    }

    // If segmenting is required
    if (segmentDuration || segmentSize) {
        // TODO: format === m3u8
        command.push('-f', 'segment');

        if (segmentDuration) {
            command.push('-segment_time', `${segmentDuration}`);
        } else {
            let { duration, size } = await getMediaInfo(file);
            const avgBitrate = (size * 8) / duration; // in bits per second
            segmentDuration = (segmentSize * 8) / avgBitrate; // Target segment duration
        }

        command.push(
            '-g', '9',
            '-sc_threshold', '0',
            '-force_key_frames', 'expr:gte(t,n_forced*9)',
            '-reset_timestamps', '1',
            '-map', '0'
        );

        if (format === 'hls')
            format = 'ts';

        command.push(`${file.name.replace(`.${fileExtension}`, `_segment_%d.${format || fileExtension}`)}`);
    } else if (format) {
        command.push(`${file.name.replace(`.${fileExtension}`, `.${format}`)}`);
    } else {
        command.push(file.name);
    }

    return command
}

function getFormat(file) {
    if (file.type) {
        return file.type.split('/').pop().toLowerCase();
    } else {
        const fileExtension = file.name.split('.').pop().toLowerCase();
        // Optionally, map the file extension to a known format here
        return fileExtension;
    }
}


const contentType = {
    // Video formats
    mp4: {
        type: 'video/mp4',
        videoCodec: 'libx264',
        audioCodec: 'aac',
        extraOptions: ['-movflags', '+faststart'],
    },
    webm: {
        type: 'video/webm',
        videoCodec: 'libvpx-vp9',
        audioCodec: 'libvorbis',
    },
    mkv: {
        type: 'video/x-matroska',
        videoCodec: 'libx265',
        audioCodec: 'aac',
    },
    avi: {
        type: 'video/x-msvideo',
        videoCodec: 'mpeg4',
        audioCodec: 'libmp3lame',
    },
    mov: {
        type: 'video/quicktime',
        videoCodec: 'libx264',
        audioCodec: 'aac',
    },
    flv: {
        type: 'video/x-flv',
        videoCodec: 'flv',
        audioCodec: 'mp3',
    },
    ogg: {
        type: 'video/ogg',
        videoCodec: 'libtheora',
        audioCodec: 'libvorbis',
    },
    mpeg: {
        type: 'video/mpeg',
        videoCodec: 'mpeg2video',
        audioCodec: 'mp2',
    },
    hls: {
        type: 'application/vnd.apple.mpegurl', // For .m3u8 playlist files
        segmentContentType: 'mp2t', // For .ts segment files
        videoCodec: 'libx264',
        audioCodec: 'aac',
        extraOptions: ['-hls_time', '10', '-hls_list_size', '0', '-f', 'hls']
    },

    // Audio formats
    mp3: {
        type: 'audio/mpeg',
        audioCodec: 'libmp3lame',
    },
    aac: {
        type: 'audio/aac',
        audioCodec: 'aac',
    },
    oggAudio: {
        type: 'audio/ogg',
        audioCodec: 'libvorbis',
    },
    opus: {
        type: 'audio/opus',
        audioCodec: 'libopus',
    },
    wav: {
        type: 'audio/wav',
        audioCodec: 'pcm_s16le',
    },
};

// Example usage (you'll likely tie this to an event listener on a file input)
document.getElementById('fileInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
        const targetSegmentSizeBytes = 10 * 1024 * 1024; // 10MB in bytes
        let segment = await processFile(file, 4);
        console.log('test2')
    }
});

const streamConfigExample = {
    title: "Video Title",
    totalDuration: 3600, // Total duration of the video in seconds
    'content-type': "video/mp4",
    segments: [
        {
            _id: 1,
            src: "http://example.com/video/chunk1.mp4", // src stored using file path
            start: 0, // Start time of this chunk in seconds
            end: 10, // End time of this chunk in seconds
            duration: 10,
            codec: "h.264",
            resolution: {
                width: 1920,
                height: 1080
            },
            bitrate: "5000kbps",
        },
        // Repeat for each chunk
    ]
}

// init()