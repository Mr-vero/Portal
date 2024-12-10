// WebRTC configuration
const peerConnection = new RTCPeerConnection({
    iceServers: [
        { urls: 'stun:stun3.l.google.com:19302' }
    ]
});
let dataChannel;
let connectionId;
let pendingCandidates = [];

// Generate or use existing connection ID from URL
function initializeConnection() {
    const urlParams = new URLSearchParams(window.location.search);
    connectionId = urlParams.get('id');
    
    // Add connection timeout
    setTimeout(() => {
        if (dataChannel?.readyState !== 'open') {
            console.log("Connection timeout - cleaning up");
            cleanup();
            alert("Connection timed out. Please refresh the page to try again.");
        }
    }, 30000); // 30 second timeout
    
    if (!connectionId) {
        // Generate new connection ID if none exists
        connectionId = Math.random().toString(36).substring(2, 15);
        window.history.pushState({}, '', `?id=${connectionId}`);
        initiatePeerConnection();
    } else {
        // Join existing connection
        joinPeerConnection();
    }
}

function initiatePeerConnection() {
    try {
        dataChannel = peerConnection.createDataChannel("chat", {
            ordered: true
        });
        console.log("Data channel created by initiator");
        setupDataChannel();
    } catch (e) {
        console.error("Error creating data channel:", e);
        return;
    }
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("New ICE candidate (initiator):", event.candidate);
            const candidates = JSON.parse(localStorage.getItem(`${connectionId}_candidates_offer`) || '[]');
            candidates.push(event.candidate);
            localStorage.setItem(`${connectionId}_candidates_offer`, JSON.stringify(candidates));
        }
    };

    console.log("Creating offer...");
    peerConnection.createOffer()
        .then(offer => {
            console.log("Offer created");
            return peerConnection.setLocalDescription(offer);
        })
        .then(() => {
            console.log("Local description set");
            localStorage.setItem(`${connectionId}_offer`, JSON.stringify(peerConnection.localDescription));
            checkForAnswer();
        })
        .catch(e => console.error("Error in offer creation:", e));
}

function joinPeerConnection() {
    console.log("Joining peer connection");
    
    peerConnection.ondatachannel = (event) => {
        console.log("Received data channel");
        dataChannel = event.channel;
        setupDataChannel();
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("New ICE candidate (joiner):", event.candidate);
            const candidates = JSON.parse(localStorage.getItem(`${connectionId}_candidates_answer`) || '[]');
            candidates.push(event.candidate);
            localStorage.setItem(`${connectionId}_candidates_answer`, JSON.stringify(candidates));
        }
    };

    const checkForOffer = setInterval(() => {
        const offerStr = localStorage.getItem(`${connectionId}_offer`);
        if (offerStr) {
            clearInterval(checkForOffer);
            const offer = JSON.parse(offerStr);
            console.log("Found offer, setting remote description");
            
            peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
                .then(() => {
                    console.log("Remote description set, creating answer");
                    // Add pending ICE candidates after remote description is set
                    pendingCandidates.forEach(candidate => {
                        peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                            .catch(e => console.error("Error adding pending ICE candidate:", e));
                    });
                    pendingCandidates = [];
                    return peerConnection.createAnswer();
                })
                .then(answer => {
                    console.log("Answer created, setting local description");
                    return peerConnection.setLocalDescription(answer);
                })
                .then(() => {
                    console.log("Local description set, storing answer");
                    localStorage.setItem(`${connectionId}_answer`, JSON.stringify(peerConnection.localDescription));
                    addICECandidates();
                })
                .catch(e => console.error("Error in answer process:", e));
        }
    }, 1000);
}

function setupDataChannel() {
    console.log("Setting up data channel:", dataChannel.label);
    console.log("Initial data channel state:", dataChannel.readyState);

    dataChannel.onopen = () => {
        console.log("Data channel is open");
        document.getElementById('connectionStatus').textContent = 'Connected';
        document.getElementById('connectionId').textContent = `Connection ID: ${connectionId}`;
    };

    dataChannel.onerror = (error) => {
        console.error("Data Channel Error:", error);
    };

    dataChannel.onclose = () => {
        console.log("Data channel closed");
        document.getElementById('connectionStatus').textContent = 'Disconnected';
    };

    let expectedFile = null;
    let receivedChunks = [];
    let receivedSize = 0;

    dataChannel.onmessage = (event) => {
        if (typeof event.data === 'string') {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'file-meta') {
                    // Initialize file reception
                    expectedFile = data;
                    receivedChunks = [];
                    receivedSize = 0;
                    return;
                }
            } catch (e) {
                // If it's not JSON, treat it as a regular message
                appendMessage(`Peer: ${event.data}`);
            }
        } else if (event.data instanceof ArrayBuffer && expectedFile) {
            // Accumulate file chunks
            receivedChunks.push(event.data);
            receivedSize += event.data.byteLength;

            // Check if file is completely received
            if (receivedSize === expectedFile.size) {
                // Combine chunks into a single blob
                const blob = new Blob(receivedChunks, { type: expectedFile.mimeType || 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                
                // Create appropriate icon based on file type
                let fileIcon = 'fa-file';
                if (expectedFile.mimeType) {
                    if (expectedFile.mimeType.startsWith('image/')) fileIcon = 'fa-file-image';
                    else if (expectedFile.mimeType.startsWith('video/')) fileIcon = 'fa-file-video';
                    else if (expectedFile.mimeType.startsWith('audio/')) fileIcon = 'fa-file-audio';
                    else if (expectedFile.mimeType.startsWith('text/')) fileIcon = 'fa-file-alt';
                    else if (expectedFile.mimeType.includes('pdf')) fileIcon = 'fa-file-pdf';
                }

                appendMessage(`
                    Peer sent a file: 
                    <div class="file-message" data-type="${expectedFile.mimeType}">
                        <i class="fas ${fileIcon}"></i>
                        <a href="${url}" download="${expectedFile.name}">
                            ${expectedFile.name} (${formatFileSize(expectedFile.size)})
                        </a>
                    </div>
                `);

                // Reset file reception
                expectedFile = null;
                receivedChunks = [];
                receivedSize = 0;
            }
        }
    };
}

// Add helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Check for answer and ICE candidates
function checkForAnswer() {
    const interval = setInterval(() => {
        const answerStr = localStorage.getItem(`${connectionId}_answer`);
        if (answerStr) {
            const answer = JSON.parse(answerStr);
            peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
                .then(() => {
                    clearInterval(interval);
                    // Add pending ICE candidates after remote description is set
                    pendingCandidates.forEach(candidate => {
                        peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                            .catch(e => console.error("Error adding pending ICE candidate:", e));
                    });
                    pendingCandidates = [];
                    addICECandidates();
                })
                .catch(e => console.error("Error setting remote description:", e));
        }
    }, 1000);
}

// Send message
document.getElementById('sendMessage').addEventListener('click', () => {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value;
    
    if (!dataChannel) {
        console.error("No data channel available");
        alert("Connection not established yet. Please wait.");
        return;
    }
    
    console.log("Data channel state:", dataChannel.readyState);
    
    if (dataChannel.readyState === 'open') {
        dataChannel.send(message);
        appendMessage(`You: ${message}`);
        messageInput.value = '';
    } else {
        console.error("Data channel is not open. Current state:", dataChannel.readyState);
        alert("Still establishing connection. Please wait a moment and try again.");
    }
});

// Send file
document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file && dataChannel && dataChannel.readyState === 'open') {
        // First send file metadata
        const fileMetadata = {
            type: 'file-meta',
            name: file.name,
            size: file.size,
            mimeType: file.type
        };
        dataChannel.send(JSON.stringify(fileMetadata));

        // Then send the file data in chunks
        const chunkSize = 16384; // 16KB chunks
        const fileReader = new FileReader();
        let offset = 0;

        fileReader.onload = (e) => {
            dataChannel.send(e.target.result);
            offset += e.target.result.byteLength;
            
            if (offset < file.size) {
                // Read the next chunk
                readChunk();
            } else {
                // File transfer complete
                appendMessage(`You sent a file: ${file.name}`);
            }
        };

        const readChunk = () => {
            const slice = file.slice(offset, offset + chunkSize);
            fileReader.readAsArrayBuffer(slice);
        };

        readChunk(); // Start reading the first chunk
    } else if (!dataChannel || dataChannel.readyState !== 'open') {
        alert("Connection not established yet. Please wait.");
    }
});

// Append message to chat box and save to localStorage
function appendMessage(message) {
    const chatBox = document.getElementById('chatBox');
    chatBox.value += message + '\n';
    localStorage.setItem('chatHistory', chatBox.value);
}

// Add ICE candidate handling for both peers
function addICECandidates() {
    const isInitiator = !peerConnection.remoteDescription;
    
    if (isInitiator) {
        // For initiator: check answer candidates
        const answerCandidates = JSON.parse(localStorage.getItem(`${connectionId}_candidates_answer`) || '[]');
        answerCandidates.forEach(candidate => {
            if (candidate && peerConnection.remoteDescription) {
                peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                    .catch(e => console.error("Error adding answer ICE candidate:", e));
            } else if (candidate) {
                pendingCandidates.push(candidate);
            }
        });
    } else {
        // For joiner: check offer candidates
        const offerCandidates = JSON.parse(localStorage.getItem(`${connectionId}_candidates_offer`) || '[]');
        offerCandidates.forEach(candidate => {
            if (candidate && peerConnection.remoteDescription) {
                peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                    .catch(e => console.error("Error adding offer ICE candidate:", e));
            } else if (candidate) {
                pendingCandidates.push(candidate);
            }
        });
    }
}

// Add connection state monitoring
peerConnection.onconnectionstatechange = (event) => {
    console.log("Connection state:", peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
        console.log("Peers connected!");
    }
};

// Add ICE connection state monitoring
peerConnection.oniceconnectionstatechange = (event) => {
    console.log("ICE connection state:", peerConnection.iceConnectionState);
};

// Add cleanup function
function cleanup() {
    localStorage.removeItem(`${connectionId}_offer`);
    localStorage.removeItem(`${connectionId}_answer`);
    localStorage.removeItem(`${connectionId}_candidates_offer`);
    localStorage.removeItem(`${connectionId}_candidates_answer`);
}

// Add window unload handler
window.onbeforeunload = () => {
    cleanup();
};

// Initialize the connection
console.log("Initializing connection...");
initializeConnection();