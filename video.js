document.getElementById("ai").addEventListener("change", toggleAi);
document.getElementById("fps").addEventListener("input", changeFps);

const video = document.getElementById("video");
const c1 = document.getElementById('c1');
const ctx1 = c1.getContext('2d');
let cameraAvailable = false;
let aiEnabled = false;
let fps = 30;
let lastResults = [];

// Color detection canvas (hidden)
const colorCanvas = document.createElement('canvas');
const colorCtx = colorCanvas.getContext('2d');

// Camera setup
const constraints = {
    audio: false,
    video: { facingMode: "environment" }
};

function camera() {
    if (!cameraAvailable) {
        navigator.mediaDevices.getUserMedia(constraints)
            .then(stream => {
                cameraAvailable = true;
                video.srcObject = stream;
            })
            .catch(err => {
                console.error("Camera error:", err);
                if (document.getElementById("loadingText")) {
                    document.getElementById("loadingText").innerText = "Camera access denied";
                }
            });
    }
}

// Initialize
window.onload = function () {
    camera();
    timerCallback();
};

function timerCallback() {
    if (isReady()) {
        setResolution();
        ctx1.drawImage(video, 0, 0, c1.width, c1.height);
        if (aiEnabled) ai();
    }
    setTimeout(timerCallback, 1000 / fps);
}

function isReady() {
    if (modelIsLoaded && cameraAvailable) {
        document.getElementById("loadingText").style.display = "none";
        document.getElementById("ai").disabled = false;
        document.getElementById("speakBtn").disabled = false;
        return true;
    }
    return false;
}

// Speak button functionality
document.getElementById("speakBtn").addEventListener("click", () => {
    if (!('speechSynthesis' in window)) {
        alert("Speech synthesis not supported in your browser.");
        return;
    }

    let msg;
    if (!lastResults.length) {
        msg = "I don't see any objects right now.";
    } else {
        const counts = lastResults.reduce((acc, r) => {
            acc[r.label] = (acc[r.label] || 0) + 1;
            return acc;
        }, {});
        const parts = Object.entries(counts)
            .map(([label, n]) => `${n} ${label}${n > 1 ? 's' : ''}`);
        msg = "I see " + parts.join(", ") + ".";
    }

    const utterance = new SpeechSynthesisUtterance(msg);
    speechSynthesis.speak(utterance);
});

// Helper functions
function setResolution() {
    if (window.screen.width < video.videoWidth) {
        c1.width = window.screen.width * 0.9;
        c1.height = video.videoHeight * (c1.width / video.videoWidth);
    } else {
        c1.width = video.videoWidth;
        c1.height = video.videoHeight;
    }
}

function toggleAi() {
    aiEnabled = document.getElementById("ai").checked;
}

function changeFps() {
    fps = 1000 / document.getElementById("fps").value;
}

function ai() {
    objectDetector.detect(c1, (err, results) => {
        if (err) {
            console.error(err);
            return;
        }
        lastResults = results;
        ctx1.clearRect(0, 0, c1.width, c1.height);
        ctx1.drawImage(video, 0, 0, c1.width, c1.height);

        results.forEach(obj => {
            ctx1.font = "16px Arial";
            ctx1.fillStyle = "#FFFFFF";
            ctx1.fillText(
                `${obj.label} (${(obj.confidence * 100).toFixed(1)}%)`,
                obj.x + 5,
                obj.y + 20
            );
            ctx1.strokeStyle = "#FFFFFF";
            ctx1.lineWidth = 2;
            ctx1.strokeRect(obj.x, obj.y, obj.width, obj.height);
        });

        // Update classification display
        updateClassificationDisplay(results);
    });
}

// Color detection and classification functions
function getObjectColor(x, y, width, height) {
    // Set up color detection canvas
    colorCanvas.width = width;
    colorCanvas.height = height;

    // Draw the object region to the color canvas
    colorCtx.drawImage(video, x, y, width, height, 0, 0, width, height);

    // Get image data
    const imageData = colorCtx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Enhanced color analysis with multiple methods
    const colorAnalysis = analyzeColors(data);

    return {
        name: colorAnalysis.dominantColor,
        hex: colorAnalysis.hex,
        rgb: colorAnalysis.rgb,
        confidence: colorAnalysis.confidence,
        secondary: colorAnalysis.secondaryColor
    };
}

function analyzeColors(data) {
    // Color histogram approach for better accuracy
    const colorBuckets = {};
    const colorCounts = {};
    let totalPixels = 0;

    // Analyze pixels with brightness and saturation filtering
    for (let i = 0; i < data.length; i += 16) { // Sample every 4th pixel for performance
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const alpha = data[i + 3];

        // Skip transparent or very dark/bright pixels for better color detection
        if (alpha < 128) continue;

        const brightness = (r + g + b) / 3;
        if (brightness < 30 || brightness > 240) continue;

        // Convert to HSV for better color classification
        const hsv = rgbToHsv(r, g, b);

        // Skip very low saturation (gray) pixels unless they're clearly gray
        if (hsv.s < 0.15 && brightness > 60 && brightness < 200) {
            // This is likely a gray pixel
            const grayKey = 'white';
            colorCounts[grayKey] = (colorCounts[grayKey] || 0) + 1;
        } else if (hsv.s >= 0.15) {
            // Classify by hue for saturated colors
            const colorKey = getColorFromHSV(hsv.h, hsv.s, hsv.v);
            colorCounts[colorKey] = (colorCounts[colorKey] || 0) + 1;

            // Store RGB values for this color category
            if (!colorBuckets[colorKey]) {
                colorBuckets[colorKey] = { r: 0, g: 0, b: 0, count: 0 };
            }
            colorBuckets[colorKey].r += r;
            colorBuckets[colorKey].g += g;
            colorBuckets[colorKey].b += b;
            colorBuckets[colorKey].count++;
        }

        totalPixels++;
    }

    if (totalPixels === 0) {
        return { dominantColor: 'Unknown', hex: '#888888', rgb: { r: 136, g: 136, b: 136 }, confidence: 0 };
    }

    // Find dominant and secondary colors
    const sortedColors = Object.entries(colorCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([color, count]) => ({ color, count, percentage: (count / totalPixels) * 100 }));

    if (sortedColors.length === 0) {
        return { dominantColor: 'Unknown', hex: '#888888', rgb: { r: 136, g: 136, b: 136 }, confidence: 0 };
    }

    const dominantColorName = sortedColors[0].color;
    const confidence = Math.min(sortedColors[0].percentage, 100);

    // Calculate average RGB for the dominant color
    let avgR, avgG, avgB;
    if (colorBuckets[dominantColorName]) {
        const bucket = colorBuckets[dominantColorName];
        avgR = Math.round(bucket.r / bucket.count);
        avgG = Math.round(bucket.g / bucket.count);
        avgB = Math.round(bucket.b / bucket.count);
    } else {
        // Fallback for gray colors
        const grayValue = dominantColorName === 'white' ? 128 : 136;
        avgR = avgG = avgB = grayValue;
    }

    return {
        dominantColor: getEnhancedColorName(dominantColorName),
        hex: rgbToHex(avgR, avgG, avgB),
        rgb: { r: avgR, g: avgG, b: avgB },
        confidence: Math.round(confidence),
        secondaryColor: sortedColors.length > 1 ? getEnhancedColorName(sortedColors[1].color) : null
    };
}

function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;

    let h = 0;
    if (diff !== 0) {
        if (max === r) {
            h = ((g - b) / diff) % 6;
        } else if (max === g) {
            h = (b - r) / diff + 2;
        } else {
            h = (r - g) / diff + 4;
        }
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;

    const s = max === 0 ? 0 : diff / max;
    const v = max;

    return { h, s, v };
}

function getColorFromHSV(hue, saturation, value) {
    // Enhanced hue-based color classification
    if (saturation < 0.2) return 'grey';
    if (value < 0.2) return 'black';
    if (value > 0.9 && saturation < 0.3) return 'white';

    // More precise hue ranges for better color detection
    if (hue >= 0 && hue < 15) return 'red';
    if (hue >= 15 && hue < 45) return 'orange';
    if (hue >= 45 && hue < 75) return 'yellow';
    if (hue >= 75 && hue < 150) return 'green';
    if (hue >= 150 && hue < 210) return 'cyan';
    if (hue >= 210 && hue < 270) return 'blue';
    if (hue >= 270 && hue < 330) return 'purple';
    if (hue >= 330 && hue < 360) return 'red';

    return 'unknown';
}

function getEnhancedColorName(colorKey) {
    const colorMap = {
        'red': 'Red',
        'orange': 'Orange',
        'yellow': 'Yellow',
        'green': 'Green',
        'cyan': 'Cyan',
        'blue': 'Blue',
        'purple': 'Purple',
        'pink': 'Pink',
        'brown': 'Brown',
        'black': 'Black',
        'white': 'White',
        'gray': 'Gray',
        'grey': 'Gray',
        'navy': 'Navy Blue',
        'maroon': 'Maroon',
        'teal': 'Teal',
        'olive': 'Olive',
        'lime': 'Lime Green',
        'magenta': 'Magenta',
        'unknown': 'Unknown'
    };

    return colorMap[colorKey] || 'Unknown';
}

function getColorName(r, g, b) {
    const colors = [
        { name: 'Red', r: 255, g: 0, b: 0 },
        { name: 'Green', r: 0, g: 255, b: 0 },
        { name: 'Blue', r: 0, g: 0, b: 255 },
        { name: 'Yellow', r: 255, g: 255, b: 0 },
        { name: 'Orange', r: 255, g: 165, b: 0 },
        { name: 'Purple', r: 128, g: 0, b: 128 },
        { name: 'Pink', r: 255, g: 192, b: 203 },
        { name: 'Brown', r: 165, g: 42, b: 42 },
        { name: 'Black', r: 0, g: 0, b: 0 },
        { name: 'White', r: 255, g: 255, b: 255 },
        { name: 'Gray', r: 128, g: 128, b: 128 },
        { name: 'Navy', r: 0, g: 0, b: 128 },
        { name: 'Maroon', r: 128, g: 0, b: 0 },
        { name: 'Teal', r: 0, g: 128, b: 128 },
        { name: 'Olive', r: 128, g: 128, b: 0 }
    ];

    let closestColor = colors[0];
    let minDistance = Infinity;

    colors.forEach(color => {
        const distance = Math.sqrt(
            Math.pow(r - color.r, 2) +
            Math.pow(g - color.g, 2) +
            Math.pow(b - color.b, 2)
        );

        if (distance < minDistance) {
            minDistance = distance;
            closestColor = color;
        }
    });

    return closestColor.name;
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function getObjectSize(width, height) {
    const area = width * height;
    if (area < 5000) return 'Small';
    if (area < 20000) return 'Medium';
    return 'Large';
}

function updateClassificationDisplay(results) {
    const detectedObjectsDiv = document.getElementById('detectedObjects');

    if (!results || results.length === 0) {
        detectedObjectsDiv.innerHTML = '<p class="no-objects">No objects detected</p>';
        return;
    }

    let html = '';
    results.forEach((obj, index) => {
        const color = getObjectColor(obj.x, obj.y, obj.width, obj.height);
        const size = getObjectSize(obj.width, obj.height);
        const confidence = (obj.confidence * 100).toFixed(1);

        // Enhanced display with color confidence and secondary color
        let colorDisplay = `Color: ${color.name}`;
        if (color.confidence) {
            colorDisplay += ` (${color.confidence}% match)`;
        }
        if (color.secondary && color.secondary !== color.name) {
            colorDisplay += ` • Secondary: ${color.secondary}`;
        }

        html += `
            <div class="object-card">
                <div class="object-label">${obj.label}</div>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${confidence}%"></div>
                </div>
                <div class="object-details">
                    <div>Detection: ${confidence}%</div>
                    <div>Size: ${size} (${obj.width}×${obj.height}px)</div>
                    <div class="color-info">
                        <div class="color-swatch" style="background-color: ${color.hex}"></div>
                        <span>${colorDisplay}</span>
                    </div>
                    <div>Position: (${Math.round(obj.x)}, ${Math.round(obj.y)})</div>
                </div>
            </div>
        `;
    });

    detectedObjectsDiv.innerHTML = html;
}