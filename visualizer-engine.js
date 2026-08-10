const canvas = document.getElementById('visualizerCanvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// 3D Matrix Rotational states
let angleX = 0.5; 
let angleY = 0.5; 
let targetAngleX = 0.5;
let targetAngleY = 0.5;

// Drag Track variables
let isDragging = false;
let previousMouseX = 0;
let previousMouseY = 0;

window.addEventListener('mousedown', (e) => {
    isDragging = true;
    previousMouseX = e.clientX;
    previousMouseY = e.clientY;
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    targetAngleY += (e.clientX - previousMouseX) * 0.007;
    targetAngleX += (e.clientY - previousMouseY) * 0.007;
    previousMouseX = e.clientX;
    previousMouseY = e.clientY;
});

window.addEventListener('mouseup', () => isDragging = false);

const totalPoints = 150; // Increased vertex budget for organic fire sparks
const baseNodes = [];
let trailSparks = []; // Dynamic memory array tracking fire traces expiring in 1 sec

const phi = Math.PI * (3 - Math.sqrt(5)); 
for (let i = 0; i < totalPoints; i++) {
    // Shape 1: Sphere
    const sY = 1 - (i / (totalPoints - 1)) * 2; 
    const sRad = Math.sqrt(1 - sY * sY); 
    const sTheta = phi * i; 

    // Shape 2: Heart Cardioid
    const hTheta = (-Math.PI + (i / totalPoints) * Math.PI * 2);
    const hPhi = (-Math.PI / 4 + (i % 8 / 8) * Math.PI / 2);

    // Shape 3: Cylinder Tunnel
    const cAngle = (i / totalPoints) * Math.PI * 8;

    baseNodes.push({
        sphere: { x: Math.cos(sTheta) * sRad, y: sY, z: Math.sin(sTheta) * sRad },
        heart: { 
            x: 16 * Math.pow(Math.sin(hTheta), 3) * Math.cos(hPhi) * 0.05, 
            y: -(13 * Math.cos(hTheta) - 5 * Math.cos(2*hTheta) - 2 * Math.cos(3*hTheta) - Math.cos(4*hTheta)) * 0.05 - 0.2, 
            z: 16 * Math.pow(Math.sin(hTheta), 3) * Math.sin(hPhi) * 0.05 
        },
        cylinder: { x: Math.cos(cAngle) * 0.8, y: (i / totalPoints) * 2 - 1, z: Math.sin(cAngle) * 0.8 },
        freqIndex: i % 64,
        lastX: 0, // Used to compute movement velocity vectors
        lastY: 0
    });
}

let currentShapeIndex = 0;
let shapeTransitionFactor = 1.0; 
let lastShapeTime = Date.now();

startBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: { echoCancellation: false, noiseSuppression: false }
        });
        startBtn.style.display = 'none';

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const analyzer = audioContext.createAnalyser();
        analyzer.fftSize = 128; 
        source.connect(analyzer);

        const bufferLength = analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function draw() {
            requestAnimationFrame(draw);
            analyzer.getByteFrequencyData(dataArray);

            // Canvas blending layer adjustments to mimic burning embers
            ctx.fillStyle = 'rgba(2, 2, 4, 0.15)'; 
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'screen'; // Force hyper-bright glow blend modes

            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            
            let sum = 0;
            for(let i=0; i<bufferLength; i++) sum += dataArray[i];
            const volumeNormalized = sum / bufferLength / 255;
            const baseRadius = (Math.min(canvas.width, canvas.height) * 0.38) + (volumeNormalized * 180);

            const now = Date.now();
            if (now - lastShapeTime > 5000) {
                currentShapeIndex = (currentShapeIndex + 1) % 3;
                lastShapeTime = now;
                shapeTransitionFactor = 0; 
            }
            if (shapeTransitionFactor < 1.0) shapeTransitionFactor += 0.015;

            if (!isDragging) {
                targetAngleY += 0.003 + (volumeNormalized * 0.005);
                targetAngleX += 0.001;
            }
            angleX += (targetAngleX - angleX) * 0.1;
            angleY += (targetAngleY - angleY) * 0.1;

            const cosX = Math.cos(angleX); const sinX = Math.sin(angleX);
            const cosY = Math.cos(angleY); const sinY = Math.sin(angleY);

            // Compute current frame structural nodes locations
            const currentFramePoints = baseNodes.map(node => {
                let fromTarget = node.sphere; let toTarget = node.heart;
                if (currentShapeIndex === 1) { fromTarget = node.heart; toTarget = node.cylinder; }
                else if (currentShapeIndex === 2) { fromTarget = node.cylinder; toTarget = node.sphere; }

                const mixX = fromTarget.x + (toTarget.x - fromTarget.x) * shapeTransitionFactor;
                const mixY = fromTarget.y + (toTarget.y - fromTarget.y) * shapeTransitionFactor;
                const mixZ = fromTarget.z + (toTarget.z - fromTarget.z) * shapeTransitionFactor;

                let x1 = mixX * cosY - mixZ * sinY;
                let z1 = mixZ * cosY + mixX * sinY;
                let y2 = mixY * cosX - z1 * sinX;
                let z2 = z1 * cosX + mixY * sinX;

                const audioAmp = dataArray[node.freqIndex] / 255;
                const finalRadius = baseRadius * (1 + audioAmp * 0.25);
                const perspective = 600 / (600 + z2 * finalRadius);

                const scrX = centerX + x1 * finalRadius * perspective;
                const scrY = centerY + y2 * finalRadius * perspective;

                // Physics Speed Tracking: If particle traveled far from its old coordinate position, trigger trail trace
                if (node.lastX !== 0 && node.lastY !== 0) {
                    const distanceMoved = Math.hypot(scrX - node.lastX, scrY - node.lastY);
                    
                    // High motion or audio transients shake out active trail sparks
                    if (distanceMoved > 1.5 || audioAmp > 0.3) {
                        trailSparks.push({
                            x: scrX,
                            y: scrY,
                            vx: (Math.random() - 0.5) * 1.5, // Subtle drifting wind speed components
                            vy: (Math.random() - 0.5) * 1.5 - (audioAmp * 2), // Rising heat physics vector
                            birth: now,
                            baseHue: (now * 0.03 + node.freqIndex * 4) % 360,
                            amp: audioAmp
                        });
                    }
                }

                node.lastX = scrX;
                node.lastY = scrY;

                return { screenX: scrX, screenY: scrY, depth: z2, amp: audioAmp, index: node.freqIndex };
            });

            // 1. Render Background Fire Sparks Trace Layers (Lasts exactly 1 sec)
            trailSparks = trailSparks.filter(spark => {
                const age = now - spark.birth;
                if (age > 1000) return false; // Hard cutout timeout after exactly 1 second

                const lifePercent = 1 - (age / 1000); // 1.0 down to 0.0
                
                // Advance physics drift vectors over time
                spark.x += spark.vx;
                spark.y += spark.vy;

                // Core Fire Color Spectrum interpolation transitions: Yellow -> Hot Orange -> Dark Fire Red
                let sparkHue = 20; // Default pure orange flame hue
                if (lifePercent > 0.7) sparkHue = 50; // White-hot electric yellow core
                else if (lifePercent < 0.3) sparkHue = 0; // Ash red fadeout

                ctx.save();
                ctx.translate(spark.x, spark.y);
                
                // Add trace glow parameters
                ctx.shadowBlur = lifePercent * 15;
                ctx.shadowColor = `hsla(${sparkHue}, 100%, 50%, ${lifePercent})`;
                ctx.fillStyle = `hsla(${sparkHue}, 100%, ${60 + lifePercent * 20}%, ${lifePercent})`;
                
                // Trace embers get progressively smaller as they cool down
                const sparkSize = Math.max(1, lifePercent * (2 + spark.amp * 3));
                ctx.fillRect(-sparkSize/2, -sparkSize/2, sparkSize, sparkSize);
                ctx.restore();

                return true;
            });

            // 2. Render Core Structural Nodes Base
            currentFramePoints.sort((a, b) => b.depth - a.depth);
            currentFramePoints.forEach(p => {
                const opacity = Math.max(0.2, (p.depth + 1) / 2);
                ctx.save();
                ctx.translate(p.screenX, p.screenY);

                // Bright electric sparks highlight properties 
                ctx.shadowBlur = p.amp * 20;
                ctx.shadowColor = '#ffffff';
                ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                
                const size = 3 + p.amp * 5;
                ctx.fillRect(-size/2, -size/2, size, size);
                ctx.restore();
            });

            ctx.globalCompositeOperation = 'source-over'; // Reset canvas blend protocols
        }
        draw();

    } catch (err) {
        console.error("Ignition fault:", err);
        alert("Please make sure to select a Chrome Tab and check 'Share tab audio'.");
        startBtn.style.display = 'block';
    }
});
