const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('inventory_dump.html', 'utf8');
const $ = cheerio.load(html);

console.log("=== İLERLEYEN DROPLAR ===");
const progressBars = $('[data-a-target="tw-progress-bar-animation"]');
console.log("Progress bar sayısı:", progressBars.length);
progressBars.each((i, el) => {
    let p = $(el).parent();
    let val = $(el).attr('value');
    console.log("Progress:", val, "%");
});

console.log("\n=== TÜM KARTLAR ===");
$('[data-test-selector="drops-campaign-details"]').each((i, el) => {
    const game = $(el).find('h4, p.tw-strong').first().text();
    console.log("Game:", game);
});

console.log("Bitti.");
