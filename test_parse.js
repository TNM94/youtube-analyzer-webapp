const fs = require('fs');
fetch('https://www.youtube.com/watch?v=W_y3ZMBpbrc').then(r => r.text()).then(html => {
    let jsonStr = null;
    try {
        const marker = 'ytInitialPlayerResponse = ';
        if (html.includes(marker)) {
            const start = html.split(marker)[1];
            jsonStr = start.split(';</script>')[0];
        } else if (html.includes('ytInitialPlayerResponse":')) {
            const start = html.split('ytInitialPlayerResponse":')[1];
            jsonStr = start.split('},"')[0] + '}';
        } else {
             const marker2 = 'var ytInitialPlayerResponse = ';
             if (html.includes(marker2)) {
                 const start2 = html.split(marker2)[1];
                 jsonStr = start2.split(';</script>')[0];
             }
        }
    } catch(e) { console.error("Parse error:", e); }

    if (!jsonStr) {
        console.log("No JSON STR!");
        return;
    }
    console.log("JSON Length:", jsonStr.length);
    try {
        const playerResponse = JSON.parse(jsonStr);
        const tracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        console.log("Tracks available:", tracks?.length);
    } catch(e) {
        // Find where JSON parse fails
        console.log("JSON PARSE FAILED!", e.message);
        console.log("End of string:", jsonStr.substring(jsonStr.length - 100));
    }
});
