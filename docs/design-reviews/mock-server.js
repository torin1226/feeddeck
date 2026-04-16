const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = '/sessions/eloquent-nice-fermat/mnt/area 51/feeddeck/dist';

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function vid(id, title, thumb, dur, durFmt, uploader, views, source, tags) {
  return {
    id, title, thumbnail: thumb, duration: dur, durationFormatted: durFmt,
    uploader, view_count: views, source, tags: tags || [],
    url: `https://example.com/watch/${id}`,
    fetched_at: new Date(Date.now() - Math.random() * 3 * 86400000).toISOString(),
    rating: (7 + Math.random() * 2.5).toFixed(1),
  };
}

const mockHomepage = {
  categories: [
    {
      key: 'trending', label: 'Trending Today',
      videos: [
        vid('t1', 'Why Every Designer Should Learn to Code', 'https://picsum.photos/seed/code1/400/225', 728, '12:08', 'DesignCourse', 340000, 'YouTube', ['design', 'code']),
        vid('t2', 'Neomorphism is Dead. Here is What Comes Next', 'https://picsum.photos/seed/neo1/400/225', 922, '15:22', 'Flux Academy', 89000, 'YouTube', ['design', 'trends']),
        vid('t3', 'I Rebuilt Netflix in 48 Hours', 'https://picsum.photos/seed/nf1/400/225', 1930, '32:10', 'Fireship', 1800000, 'YouTube', ['engineering', 'react']),
        vid('t4', 'The State of CSS in 2026', 'https://picsum.photos/seed/css1/400/225', 1245, '20:45', 'Kevin Powell', 210000, 'YouTube', ['css', 'frontend']),
        vid('t5', 'Design Leadership Lessons from Airbnb', 'https://picsum.photos/seed/airbnb1/400/225', 1710, '28:30', 'High Resolution', 67000, 'YouTube', ['leadership', 'design']),
        vid('t6', 'Building with AI in 2026', 'https://picsum.photos/seed/ai2026/400/225', 1180, '19:40', 'Two Minute Papers', 520000, 'YouTube', ['ai', 'tech']),
        vid('t7', 'The Figma Config Recap', 'https://picsum.photos/seed/figconf/400/225', 840, '14:00', 'Figma', 145000, 'YouTube', ['design', 'tools']),
        vid('t8', 'React Server Components Explained', 'https://picsum.photos/seed/rsc2/400/225', 2295, '38:15', 'Theo', 91000, 'YouTube', ['react', 'engineering']),
      ]
    },
    {
      key: 'design', label: 'Design Deep Dives',
      videos: [
        vid('d1', 'Building Design Systems at Scale', 'https://picsum.photos/seed/ds2/400/225', 1470, '24:30', 'Figma', 142000, 'YouTube', ['design', 'systems']),
        vid('d2', 'The Future of Creative Tools', 'https://picsum.photos/seed/ct2/400/225', 1125, '18:45', 'MKBHD', 2100000, 'YouTube', ['tech', 'creative']),
        vid('d3', 'Designing for Vision Pro: 1 Year Later', 'https://picsum.photos/seed/avp2/400/225', 1335, '22:15', 'WWDC Labs', 156000, 'YouTube', ['design', 'spatial']),
        vid('d4', 'Motion Design Principles for UI', 'https://picsum.photos/seed/motion2/400/225', 870, '14:30', 'The Futur', 78000, 'YouTube', ['design', 'motion']),
        vid('d5', 'Typography That Speaks', 'https://picsum.photos/seed/type1/400/225', 960, '16:00', 'Layout Land', 55000, 'YouTube', ['design', 'typography']),
        vid('d6', 'Color Theory for Digital Interfaces', 'https://picsum.photos/seed/color1/400/225', 1080, '18:00', 'DesignCourse', 98000, 'YouTube', ['design', 'color']),
      ]
    },
    {
      key: 'engineering', label: 'Engineering',
      videos: [
        vid('e1', 'Vite 7 Just Changed Everything', 'https://picsum.photos/seed/vite8/400/225', 680, '11:20', 'Fireship', 890000, 'YouTube', ['engineering', 'vite']),
        vid('e2', 'Why I Left Big Tech for Indie Dev', 'https://picsum.photos/seed/indie2/400/225', 1195, '19:55', 'TechLead', 445000, 'YouTube', ['career', 'indie']),
        vid('e3', 'Rust for JavaScript Developers', 'https://picsum.photos/seed/rust1/400/225', 1500, '25:00', 'No Boilerplate', 230000, 'YouTube', ['engineering', 'rust']),
        vid('e4', 'The Bun Runtime Deep Dive', 'https://picsum.photos/seed/bun1/400/225', 1320, '22:00', 'Theo', 340000, 'YouTube', ['engineering', 'bun']),
        vid('e5', 'Docker in 100 Seconds', 'https://picsum.photos/seed/docker1/400/225', 100, '1:40', 'Fireship', 4200000, 'YouTube', ['engineering', 'docker']),
      ]
    },
    {
      key: 'tiktok', label: 'TikTok Picks',
      videos: [
        vid('tk1', 'POV: Your First Design Crit', 'https://picsum.photos/seed/crit2/400/225', 45, '0:45', '@designlife', 3200000, 'TikTok', ['humor', 'design']),
        vid('tk2', 'CSS Trick You Didn\'t Know', 'https://picsum.photos/seed/csstrick2/400/225', 30, '0:30', '@webdevtips', 1800000, 'TikTok', ['css', 'tips']),
        vid('tk3', 'Day in the Life: Design Manager', 'https://picsum.photos/seed/dm2/400/225', 80, '1:20', '@techcareers', 890000, 'TikTok', ['career']),
        vid('tk4', 'This Figma Plugin Saves Hours', 'https://picsum.photos/seed/plugin2/400/225', 55, '0:55', '@figmatips', 2400000, 'TikTok', ['tools', 'figma']),
        vid('tk5', 'My Desk Setup Aesthetic', 'https://picsum.photos/seed/desk2/400/225', 60, '1:00', '@minimalsetup', 1500000, 'TikTok', ['productivity']),
      ]
    }
  ]
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/homepage')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(mockHomepage));
    return;
  }
  if (req.url.startsWith('/api/tags/preferences')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ liked: ['design', 'engineering'], disliked: [] }));
    return;
  }
  if (req.url.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  let filePath = path.join(DIST, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath)) filePath = path.join(DIST, 'index.html');

  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(8765, '127.0.0.1', () => console.log('Mock server running on http://127.0.0.1:8765'));
