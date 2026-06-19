import https from "https";
import * as fs from 'fs';

const url = "https://en.wikipedia.org/wiki/Ultimate_Fighting_Championship_rankings";
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    let rawHtml = '';
    res.on('data', (chunk) => { rawHtml += chunk; });
    res.on('end', () => {
        try {
            fs.writeFileSync('./tmp.html', rawHtml);
            console.log("Done");
        } catch (e) { console.error(e); }
    });
});
