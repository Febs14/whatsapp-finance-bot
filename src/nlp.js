class FinanceNLP {
  constructor() {
    this.expenseKeywords = [
      'beli', 'bayar', 'buat', 'isi', 'belanja', 'makan', 'minum',
      'bensin', 'pulsa', 'listrik', 'air', 'internet', 'sewa',
      'transport', 'ojek', 'taxi', 'bus', 'parkir', 'tol',
      'obat', 'dokter', 'rumah sakit', 'laundry', 'potong rambut',
      'print', 'fotokopi', 'cetak', 'top up', 'jajan', 'warteg',
      'ngopi', 'warung', 'tugas', 'laundry kiloan', 'kos', 'kontrakan',
      'dapur', 'beras', 'telur', 'minyak', 'sayur', 'buah', 'token'
    ];

    this.incomeKeywords = [
      'gaji', 'masuk', 'terima', 'dapat', 'bonus', 'thr',
      'freelance', 'proyek', 'komisi', 'hadiah', 'cashback',
      'refund', 'kembalian', 'untung', 'profit', 'uang saku'
    ];

    this.transferKeywords = ['pindah', 'transfer', 'tarik', 'setor', 'kirim', 'ambil'];

    this.sources = {
      'CASH': ['cash', 'tunai', 'uang', 'duit'],
      'BRI': ['bri', 'britama'],
      'BNI': ['bni', 'taplus'],
      'BCA': ['bca'],
      'MANDIRI': ['mandiri'],
      'DANA': ['dana'],
      'OVO': ['ovo'],
      'GOPAY': ['gopay', 'gojek'],
      'Shopeepay': ['shopeepay', 'shopee'],
      'LINKAJA': ['linkaja'],
      'BRK': ['brk']
    };

    this.categoryDetails = {
      'makan': { keywords: ['makan', 'sarapan', 'minum', 'kopi', 'teh', 'jajan', 'warteg'] },
      'transport': { keywords: ['bensin', 'ojek', 'taxi', 'bus', 'kereta', 'parkir', 'tol'] },
      'belanja': { keywords: ['beli', 'belanja', 'baju', 'elektronik', 'hp', 'laptop', 'sabun'] },
      'kebutuhan dapur': { keywords: ['dapur', 'beras', 'telur', 'minyak', 'sayur', 'buah'] },
      'tagihan': { keywords: ['listrik', 'air', 'pdam', 'internet', 'wifi', 'pulsa', 'sewa', 'kontrakan', 'kos', 'token'] }
    };

    this.numberPatterns = { 'ribu': 1000, 'rb': 1000, 'k': 1000, 'juta': 1e6, 'jt': 1e6, 'm': 1e6 };
  }

  parseMessage(message) {
    const text = message.toLowerCase().trim();
    const originalMessage = message.trim();
    const tokens = text.split(/\s+/);

    const result = {
      type: this.detectTransactionType(tokens),
      amount: this.extractAmount(text),
      description: originalMessage,
      detailDescription: originalMessage,
      category: 'lainnya',
      subcategory: '',
      source: this.detectSource(tokens),
      target: null,
      confidence: 0
    };

    const categoryResult = this.detectCategoryWithDetail(text, originalMessage);
    result.category = categoryResult.category;
    result.subcategory = categoryResult.subcategory;

    if (result.type === 'transfer') {
      result.target = this.detectTransferTarget(tokens, result.source);
    }

    result.confidence = this.calculateConfidence(result);

    // ✨ Clean detail description
    result.detailDescription = this.cleanDetailDescription(originalMessage, tokens);

    return result;
  }


  detectTransactionType(tokens) {
    let expense = 0, income = 0, transfer = 0;

    this.expenseKeywords.forEach(k => { if (tokens.includes(k)) expense++; });
    this.incomeKeywords.forEach(k => { if (tokens.includes(k)) income++; });
    this.transferKeywords.forEach(k => { if (tokens.includes(k)) transfer++; });

    if (transfer > 0 && (tokens.includes('ke') || tokens.includes('dari'))) return 'transfer';
    if (income > expense) return 'pemasukan';
    return 'pengeluaran';
  }

  extractAmount(text) {
    const patterns = [
      /(\d{1,3}(?:[.,]\d{3})*)/g,
      /(\d+)\s*(rb|ribu|k)/gi,
      /(\d+)\s*(jt|juta|m)/gi
    ];
    let amounts = [];
    patterns.forEach(p => {
      let m = text.match(p);
      if (m) m.forEach(match => {
        let a = this.parseIndonesianNumber(match);
        if (a > 0) amounts.push(a);
      });
    });
    return amounts.length > 0 ? Math.max(...amounts) : null;
  }

  parseIndonesianNumber(text) {
    text = text.toLowerCase().replace(/[.,]/g, '');
    for (let [suff, mult] of Object.entries(this.numberPatterns)) {
      if (text.includes(suff)) {
        let n = parseFloat(text.replace(suff, ''));
        return n * mult;
      }
    }
    let n = parseFloat(text.replace(/\D/g, ''));
    return isNaN(n) ? 0 : n;
  }

  detectCategoryWithDetail(text, originalText) {
    let best = { category: 'lainnya', subcategory: '', detail: originalText, score: 0 };
    for (let [cat, data] of Object.entries(this.categoryDetails)) {
      let score = 0;
      data.keywords.forEach(k => { if (text.includes(k)) score += 2; });
      if (score > best.score) {
        best = { category: cat, subcategory: '', detail: originalText, score };
      }
    }
    return best;
  }

  detectSource(tokens) {
    let firstKeyword = null;
    let firstIndex = Infinity;

    tokens.forEach((word, i) => {
      for (let [source, keys] of Object.entries(this.sources)) {
        if (keys.includes(word) && i < firstIndex) {
          firstIndex = i;
          firstKeyword = source.toUpperCase();
        }
      }
    });
    return firstKeyword || 'CASH';
  }

  detectTransferTarget(tokens, source) {
    let found = [];
    tokens.forEach(word => {
      for (let [acc, keys] of Object.entries(this.sources)) {
        if (keys.includes(word)) found.push(acc.toUpperCase());
      }
    });
    return found.find(acc => acc !== source) || null;
  }

  calculateConfidence(result) {
    let s = 0;
    if (result.amount) s += 20;
    if (result.category !== 'lainnya') s += 15;
    if (result.type) s += 10;
    if (result.source !== 'CASH') s += 5;
    return Math.min(s, 50);
  }

  cleanDetailDescription(originalText, tokens) {
    let cleaned = originalText;

    // Hilangkan semua pola nominal (20k, 20rb, 20 jt, 20.000, 20,000, dst.)
    const nominalPattern = /\b\d{1,3}(?:[.,]\d{3})*\b|\b\d+\s*(rb|ribu|k|jt|juta|m)\b/gi;
    cleaned = cleaned.replace(nominalPattern, '').trim();

    // Hilangkan kata sumber dana
    Object.values(this.sources).flat().forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      cleaned = cleaned.replace(regex, '').trim();
    });

    // Hilangkan kata-kata penghubung/filler
    const fillerWords = ['ke', 'dari', 'di', 'untuk', 'dengan', 'pakai', 'pake', 'dan'];
    fillerWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      cleaned = cleaned.replace(regex, '').trim();
    });

    // Bersihkan spasi berlebih
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

}

module.exports = FinanceNLP;


