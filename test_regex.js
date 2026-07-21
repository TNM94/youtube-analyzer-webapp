const fs = require('fs');
fetch('https://www.youtube.com/watch?v=ILc5vh6REXU').then(r => r.text()).then(html => {
    console.log("HTML length:", html.length);
    const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/);
    if (!match) {
        console.log("Regex failed! Let's try youtube-transcript-api approach.");
        const match2 = html.match(/"captions":({.+?})/);
        console.log("Match2 found?", !!match2);
    } else {
        console.log("Success with JSON length:", match[1].length);
    }
});
