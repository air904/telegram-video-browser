// Deprecated — streaming now handled directly in stream.js without pre-download
export default function handler(req, res) {
  res.status(410).json({ message: 'Deprecated' });
}
