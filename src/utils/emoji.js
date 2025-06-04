function getEmoji(category, type) {
  const emojiMap = {
    'makan': '🍽️',
    'transport': '🚗',
    'belanja': '🛍️',
    'tagihan': '📋',
    'kesehatan': '🏥',
    'hiburan': '🎬',
    'sedekah': '🤲',
    'lainnya': '💸'
  };

  if (type === 'pemasukan') return '💰';
  if (type === 'transfer') return '🔄';

  return emojiMap[category] || '💸';
}

module.exports = getEmoji;
