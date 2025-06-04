const getEmoji = require('./utils/emoji');
const nlp = new (require('./nlp'))();
const sheets = new (require('./sheets'))();

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');

// SOLUSI 1: Terima client sebagai parameter
async function handleMessage(client, message) {
    try {
        if (message.from.includes('@g.us') || message.from.includes('@broadcast')) return;

        const text = message.body.trim();
        if (text.startsWith('/')) {
            await handleCommand(client, message); // Sekarang client sudah tersedia
            return;
        }
        if (text.length < 5) return;

        const parsed = nlp.parseMessage(text);
        if (parsed.confidence >= 25 && parsed.amount) {
            await processTransaction(message, parsed);
        } else if (parsed.amount) {
            await askConfirmation(message, parsed);
        }
    } catch (err) {
        console.error('❌ Error handling message:', err);
        await message.reply('❌ Maaf, ada error. Coba lagi ya!');
    }
}

async function processTransaction(message, data) {
    try {
        console.log('📝 Processing transaction:', data);

        const success = await sheets.addTransaction(data);

        if (success) {
            const updatedBalances = await sheets.updateBalance(data.source, data.amount, data.type, data.target);
            const emoji = getEmoji(data.category, data.type);

            let reply = `📋 *Tercatat!*\n`;
            reply += `💰 Rp ${data.amount.toLocaleString('id-ID')},-\n`;
            reply += `📝 ${data.detailDescription}\n`;
            reply += `🏷️ ${data.category}`;
            if (data.subcategory && data.subcategory !== 'umum') {
                reply += ` > ${data.subcategory}`;
            }

            if (data.type === 'pengeluaran') {
                reply += `\n💸 Pengeluaran`;
            } else if (data.type === 'pemasukan') {
                reply += `\n💰 Pemasukan`;
            } else if (data.type === 'transfer') {
                reply += `\n🔄 Transfer`;
            }

            if (data.type === 'transfer' && data.target) {
                const sourceSaldo = updatedBalances[data.source] || 0;
                const targetSaldo = updatedBalances[data.target] || 0;

                reply += `\n💳 ${data.source}: Rp ${sourceSaldo.toLocaleString('id-ID')},-`;
                reply += `\n💳 ${data.target}: Rp ${targetSaldo.toLocaleString('id-ID')},-`;
            } else {
                const sourceSaldo = updatedBalances[data.source] || 0;
                reply += `\n💳 ${data.source}: Rp ${sourceSaldo.toLocaleString('id-ID')},-`;
            }

            await message.reply(reply);
        } else {
            let errorReply = '❌ *Gagal menyimpan transaksi*\n\n';
            errorReply += '🔍 **Data yang dideteksi:**\n';
            errorReply += `• Jenis: ${data.type}\n`;
            errorReply += `• Nominal: Rp ${data.amount.toLocaleString('id-ID')}\n`;
            errorReply += `• Kategori: ${data.category}\n`;
            errorReply += `• Sumber: ${data.source}\n`;
            errorReply += `• Keterangan: ${data.detailDescription}\n\n`;
            errorReply += '🔧 Kemungkinan masalah:\n';
            errorReply += '• Koneksi internet tidak stabil\n';
            errorReply += '• Google Sheets tidak dapat diakses\n';
            errorReply += '• Kredensial Google tidak valid\n\n';
            errorReply += 'Ketik */test* untuk cek status koneksi';

            await message.reply(errorReply);
        }
    } catch (error) {
        console.error('❌ Error processing transaction:', error);

        let errorMsg = '❌ *Terjadi error saat memproses transaksi*\n\n';
        errorMsg += `🐛 Error: ${error.message}\n\n`;
        errorMsg += 'Coba lagi dalam beberapa saat atau hubungi admin jika masalah berlanjut.';

        await message.reply(errorMsg);
    }
}

async function askConfirmation(message, data) {
    try {
        let confirmText = `🤔 *Konfirmasi Transaksi*\n\n`;
        confirmText += `Jenis: ${data.type}\n`;
        confirmText += `💰 Nominal: Rp ${data.amount.toLocaleString('id-ID')}\n`;
        confirmText += `🏷️ Kategori: ${data.category}\n`;
        confirmText += `💳 Sumber: ${data.source}\n`;
        confirmText += `📝 Keterangan: ${data.detailDescription}\n`;
        confirmText += `📊 Confidence: ${data.confidence}%\n\n`;
        confirmText += `Balas *"ya"* untuk simpan atau koreksi yang salah`;

        await message.reply(confirmText);
    } catch (error) {
        console.error('❌ Error confirmation:', error);
    }
}

async function handleCommand(client, message) {
    const cmd = message.body.toLowerCase().trim();

    try {
        if (cmd.startsWith('/rekap')) {
            try {
                const parts = message.body.split(' ');
                const periode = parts[1] || '';
                const filterType = parts[2] || '';

                const transaksi = await sheets.rekapTransaksiData(periode, filterType);

                if (transaksi.length === 0) {
                    await message.reply(`📅 Tidak ada data untuk ${periode} ${filterType ? `(${filterType})` : ''}`);
                } else {
                    await sendRekapPDF(client, message, periode, filterType, transaksi);
                }
            } catch (error) {
                console.error('❌ Error /rekap:', error);
                await message.reply('❌ Error saat membuat rekap PDF.');
            }
        } else {
            switch (cmd) {
                case '/saldo':
                    const balances = await sheets.getBalance();
                    let balanceText = '💳 *Saldo Rekening:*\n\n';

                    let totalBalance = 0;
                    for (let [account, balance] of Object.entries(balances)) {
                        balanceText += `• ${account}: Rp ${balance.toLocaleString('id-ID')}\n`;
                        totalBalance += balance;
                    }

                    balanceText += `\n💰 *Total: Rp ${totalBalance.toLocaleString('id-ID')}*`;
                    await message.reply(balanceText);
                    break;

                case '/help':
                    const helpText = `🤖 *Bot Keuangan Natural*

*📱 Cara Pakai:*
Cukup ketik transaksi secara natural, bot akan otomatis mengenali dan menyimpan:
• Contoh: "Beli makan siang 20rb di BRI"
• Contoh: "Gaji masuk 2jt di BCA"

*🔧 Command yang tersedia:*
• /saldo ➜ Cek semua saldo rekening
• /rekap [periode] [jenis] ➜ Rekap PDF transaksi
• /test ➜ Cek koneksi bot dan Google Sheets
• /reset ➜ Reset koneksi Google Sheets
• /debug ➜ Lihat detail debugging sistem
• /config ➜ Lihat konfigurasi bot
• /help ➜ Tampilkan bantuan ini

*🏷️ Kategori utama yang didukung:*
• Makan & Minuman, Transport, Belanja, Tagihan, Kebutuhan Dapur, dll.

Ketik saja dan bot akan memprosesnya secara otomatis! 🚀`;

                    await message.reply(helpText);
                    break;

                case '/test':
                    let testText = '🔧 *Status Bot:*\n\n';
                    testText += '✅ WhatsApp: Connected\n';

                    try {
                        const testBalance = await sheets.getBalance('CASH');
                        testText += '✅ Google Sheets: Connected\n';
                        testText += `📊 Test Saldo CASH: Rp ${testBalance.toLocaleString('id-ID')}`;
                    } catch (error) {
                        testText += '❌ Google Sheets: Error\n';
                        testText += `Error: ${error.message}`;
                    }

                    await message.reply(testText);
                    break;

                case '/demo':
                    const demoText = `🎮 *Demo NLP Parser:*

Kirim pesan seperti:
• "Beli nasi gudeg 35rb"
• "Isi bensin pertamax 100ribu"  
• "Gaji freelance masuk 2.5jt di BCA"
• "Bayar netflix 54rb"

Bot akan parsing otomatis! 🚀`;

                    await message.reply(demoText);
                    break;

                case '/reset':
                    try {
                        sheets.isAuthenticated = false;
                        const reconnected = await sheets.authenticate();

                        if (reconnected) {
                            await message.reply('✅ *Koneksi Google Sheets berhasil di-reset!*\n\nSekarang coba kirim transaksi lagi.');
                        } else {
                            await message.reply('❌ *Gagal reset koneksi*\n\nPeriksa konfigurasi .env dan pastikan Google Sheet sudah di-share dengan benar.');
                        }
                    } catch (error) {
                        await message.reply(`❌ *Error saat reset:* ${error.message}`);
                    }
                    break;

                case '/debug':
                    let debugText = '🔍 *Debug Information:*\n\n';
                    debugText += '📋 *Environment Variables:*\n';
                    debugText += `• GOOGLE_SERVICE_EMAIL: ${process.env.GOOGLE_SERVICE_EMAIL ? '✅ Set' : '❌ Missing'}\n`;
                    debugText += `• GOOGLE_PRIVATE_KEY: ${process.env.GOOGLE_PRIVATE_KEY ? '✅ Set' : '❌ Missing'}\n`;
                    debugText += `• GOOGLE_SHEET_ID: ${process.env.GOOGLE_SHEET_ID ? '✅ Set' : '❌ Missing'}\n`;

                    debugText += '\n🔗 *Connection Status:*\n';
                    debugText += `• Authenticated: ${sheets.isAuthenticated ? '✅ Yes' : '❌ No'}\n`;

                    if (sheets.isAuthenticated && sheets.doc) {
                        debugText += `• Document Title: ${sheets.doc.title || 'Unknown'}\n`;
                        debugText += `• Sheet ID: ${process.env.GOOGLE_SHEET_ID ? process.env.GOOGLE_SHEET_ID.substring(0, 10) + '...' : 'Not set'}\n`;

                        const sheetNames = Object.keys(sheets.doc.sheetsByTitle || {});
                        debugText += `• Available Sheets: ${sheetNames.length > 0 ? sheetNames.join(', ') : 'None'}\n`;
                    }

                    const memUsage = process.memoryUsage();
                    debugText += '\n💾 *Memory Usage:*\n';
                    debugText += `• RSS: ${Math.round(memUsage.rss / 1024 / 1024)} MB\n`;
                    debugText += `• Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)} MB\n`;

                    await message.reply(debugText);
                    break;

                case '/config':
                    let configText = '⚙️ *Bot Configuration:*\n\n';
                    configText += '📋 *Current Settings:*\n';
                    configText += `• Sheet ID: ${process.env.GOOGLE_SHEET_ID ? process.env.GOOGLE_SHEET_ID.substring(0, 15) + '...' : 'Not set'}\n`;
                    configText += `• Session Name: ${process.env.SESSION_NAME || 'whatsapp-finance'}\n`;
                    configText += `• Service Email: ${process.env.GOOGLE_SERVICE_EMAIL ? process.env.GOOGLE_SERVICE_EMAIL.split('@')[0] + '@...' : 'Not set'}\n`;

                    configText += '\n🎯 *Supported Features:*\n';
                    configText += '• ✅ Natural Language Processing\n';
                    configText += '• ✅ Auto Transaction Detection\n';
                    configText += '• ✅ Multi-Source Balance Tracking\n';
                    configText += '• ✅ Category & Subcategory Recognition\n';
                    configText += `• ${sheets.isAuthenticated ? '✅' : '❌'} Google Sheets Integration\n`;

                    await message.reply(configText);
                    break;

                default:
                    await message.reply('❓ Command tidak dikenal. Ketik */help* untuk bantuan.');
            }
        }
    } catch (error) {
        console.error('❌ Error handling command:', error);
        await message.reply('❌ Error menjalankan command.');
    }
}

async function sendRekapPDF(client, message, periode, type, transaksi) {
    const doc = new PDFDocument({
        size: 'A4',
        margin: 30,
        layout: 'landscape'
    });

    const filePath = path.join(__dirname, `Rekap_${periode}_${type || 'semua'}.pdf`);
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    // Page dimensions
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 30;
    const usableWidth = pageWidth - (2 * margin);

    // ===== HEADER SECTION =====
    // Title
    doc.fontSize(20)
        .font('Helvetica-Bold')
        .fillColor('#2E5C8A')
        .text('MONEY TRACKING & BUDGETING', { align: 'center' });

    doc.moveDown(0.5);

    // Subtitle dengan background
    const subtitleY = doc.y;
    doc.rect(margin, subtitleY - 5, usableWidth, 25)
        .fillAndStroke('#E8F4FD', '#B8D4E8');

    doc.fontSize(12)
        .fillColor('#2E5C8A')
        .font('Helvetica-Bold')
        .text(`Periode: ${periode} ${type ? `(${type.toUpperCase()})` : '(SEMUA JENIS)'}`,
            margin + 10, subtitleY, { align: 'left' });

    doc.text(`Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')}`,
        pageWidth - 200, subtitleY, { align: 'right' });

    doc.moveDown(2);

    if (!transaksi.length) {
        doc.fontSize(14)
            .fillColor('black')
            .text('Tidak ada transaksi yang ditemukan untuk periode ini.', { align: 'center' });
    } else {
        // ===== SUMMARY SECTION (TOP) =====
        const summaryY = doc.y;

        // Calculate totals
        const totalPemasukan = transaksi
            .filter(t => (t.Jenis || t.jenis || t.type || '').toLowerCase() === 'pemasukan')
            .reduce((acc, t) => acc + parseInt(t.Nominal || t.nominal || t.amount || 0), 0);

        const totalPengeluaran = transaksi
            .filter(t => (t.Jenis || t.jenis || t.type || '').toLowerCase() === 'pengeluaran')
            .reduce((acc, t) => acc + parseInt(t.Nominal || t.nominal || t.amount || 0), 0);

        const totalSaving = transaksi
            .filter(t => (t.Kategori || t.kategori || '').toLowerCase().includes('saving'))
            .reduce((acc, t) => acc + parseInt(t.Nominal || t.nominal || t.amount || 0), 0);

        const totalAsset = totalPemasukan - totalPengeluaran + totalSaving;

        // Summary boxes - responsive width
        const boxCount = 4;
        const boxSpacing = 15;
        const boxWidth = (usableWidth - (boxSpacing * (boxCount - 1))) / boxCount;
        const boxHeight = 60;
        const startX = margin;

        // AKUN box
        doc.rect(startX, summaryY, boxWidth, boxHeight)
            .fillAndStroke('#4A90E2', '#4A90E2');
        doc.fontSize(10).fillColor('white').font('Helvetica-Bold')
            .text('AKUN', startX, summaryY + 10, { width: boxWidth, align: 'center' });
        doc.fontSize(8).fillColor('white').font('Helvetica')
            .text('Cash', startX, summaryY + 25, { width: boxWidth, align: 'center' });
        doc.fontSize(12).fillColor('white').font('Helvetica-Bold')
            .text(`Rp ${totalAsset.toLocaleString('id-ID')}`, startX, summaryY + 40, { width: boxWidth, align: 'center' });

        // Pemasukan box
        const box2X = startX + boxWidth + boxSpacing;
        doc.rect(box2X, summaryY, boxWidth, boxHeight)
            .fillAndStroke('#5CB85C', '#5CB85C');
        doc.fontSize(10).fillColor('white').font('Helvetica-Bold')
            .text('Pemasukan', box2X, summaryY + 10, { width: boxWidth, align: 'center' });
        doc.fontSize(11).fillColor('white').font('Helvetica-Bold')
            .text(`Rp ${totalPemasukan.toLocaleString('id-ID')}`, box2X, summaryY + 30, { width: boxWidth, align: 'center' });

        // Pengeluaran box
        const box3X = box2X + boxWidth + boxSpacing;
        doc.rect(box3X, summaryY, boxWidth, boxHeight)
            .fillAndStroke('#D9534F', '#D9534F');
        doc.fontSize(10).fillColor('white').font('Helvetica-Bold')
            .text('Pengeluaran', box3X, summaryY + 10, { width: boxWidth, align: 'center' });
        doc.fontSize(11).fillColor('white').font('Helvetica-Bold')
            .text(`Rp ${totalPengeluaran.toLocaleString('id-ID')}`, box3X, summaryY + 30, { width: boxWidth, align: 'center' });

        // Total Asset box
        const box4X = box3X + boxWidth + boxSpacing;
        doc.rect(box4X, summaryY, boxWidth, boxHeight)
            .fillAndStroke('#6F42C1', '#6F42C1');
        doc.fontSize(10).fillColor('white').font('Helvetica-Bold')
            .text('Total Asset', box4X, summaryY + 10, { width: boxWidth, align: 'center' });
        doc.fontSize(11).fillColor('white').font('Helvetica-Bold')
            .text(`Rp ${totalAsset.toLocaleString('id-ID')}`, box4X, summaryY + 30, { width: boxWidth, align: 'center' });

        doc.y = summaryY + boxHeight + 30;

        // ===== TRANSACTION TABLE - FULL WIDTH =====
        const tableWidth = usableWidth;
        const columns = [
            { header: 'Tanggal', width: tableWidth * 0.12, key: 'Tanggal' },
            { header: 'Kategori', width: tableWidth * 0.15, key: 'Kategori' },
            { header: 'Sub Kategori', width: tableWidth * 0.15, key: 'Sub Kategori' },
            { header: 'Metode Pembayaran', width: tableWidth * 0.15, key: 'Sumber Dana' },
            { header: 'Nominal', width: tableWidth * 0.15, key: 'Nominal' },
            { header: 'Keterangan', width: tableWidth * 0.28, key: 'Keterangan' }
        ];

        const tableStartX = margin;
        const tableStartY = doc.y;
        const rowHeight = 25;
        const headerHeight = 35;

        // Function to draw table header
        function drawTableHeader(startY) {
            // Table header with colored background
            doc.rect(tableStartX, startY, tableWidth, headerHeight)
                .fillAndStroke('#4A90E2', '#4A90E2');

            let currentX = tableStartX;
            columns.forEach(col => {
                // Header border
                doc.rect(currentX, startY, col.width, headerHeight).stroke('#FFFFFF');

                // Header text
                doc.fontSize(9)
                    .fillColor('white')
                    .font('Helvetica-Bold')
                    .text(col.header, currentX + 5, startY + 12, {
                        width: col.width - 10,
                        align: 'center'
                    });
                currentX += col.width;
            });

            return startY + headerHeight;
        }

        // Function to draw table rows
        function drawTableRow(transaction, rowY, isEven = false) {
            const bgColor = isEven ? '#F8F9FA' : '#FFFFFF';

            // Row background
            doc.rect(tableStartX, rowY, tableWidth, rowHeight)
                .fillAndStroke(bgColor, '#E0E0E0');

            let currentX = tableStartX;
            columns.forEach(col => {
                let cellValue = '';
                let textColor = '#333333';

                if (col.key === 'Nominal') {
                    const nominal = transaction[col.key] || transaction.nominal || transaction.amount || 0;
                    cellValue = `Rp ${parseInt(nominal).toLocaleString('id-ID')}`;

                    // Color based on transaction type
                    const jenis = (transaction.Jenis || transaction.jenis || '').toLowerCase();
                    if (jenis === 'pemasukan') textColor = '#5CB85C';
                    else if (jenis === 'pengeluaran') textColor = '#D9534F';
                    else textColor = '#F0AD4E';
                } else if (col.key === 'Tanggal') {
                    const tanggal = transaction[col.key] || transaction.tanggal || transaction.date || '';
                    // Format tanggal jika perlu
                    cellValue = tanggal;
                } else {
                    cellValue = transaction[col.key] || transaction[col.key.toLowerCase()] || '-';
                }

                // Cell text with proper wrapping
                doc.fontSize(8)
                    .fillColor(textColor)
                    .font('Helvetica')
                    .text(cellValue, currentX + 3, rowY + 6, {
                        width: col.width - 6,
                        height: rowHeight - 12,
                        align: col.key === 'Nominal' ? 'right' : 'left', // Only Nominal is right-aligned
                        ellipsis: true
                    });

                currentX += col.width;
            });

            return rowY + rowHeight;
        }

        // Draw initial table header
        let currentY = drawTableHeader(tableStartY);

        let rowIndex = 0;
        transaksi.forEach(transaction => {
            // Check if we need a new page (leave space for footer and chart)
            if (currentY > pageHeight - 200) {
                doc.addPage();
                currentY = 50;
                // Redraw header on new page
                currentY = drawTableHeader(currentY);
            }

            currentY = drawTableRow(transaction, currentY, rowIndex % 2 === 0);
            rowIndex++;
        });

        // ===== IMPROVED DONUT CHART WITH LABELS ON SLICES =====
        doc.moveDown(2);
        currentY += 20;

        // Check if we need new page for chart
        if (currentY > pageHeight - 180) {
            doc.addPage();
            currentY = 50;
        }

        const chartSectionY = currentY;
        const chartCenterX = pageWidth / 2; // Center the chart
        const chartCenterY = chartSectionY + 120;
        const outerRadius = 80;
        const innerRadius = 40; // For donut effect
        const labelRadius = outerRadius + 30; // Distance for labels

        // Calculate data for donut chart
        const totalAmount = totalPemasukan + totalPengeluaran + totalSaving;
        const chartData = [];

        if (totalPemasukan > 0) {
            chartData.push({
                label: 'Pemasukan',
                value: totalPemasukan,
                percentage: (totalPemasukan / totalAmount) * 100,
                color: '#4A90E2'
            });
        }

        if (totalPengeluaran > 0) {
            chartData.push({
                label: 'Pengeluaran',
                value: totalPengeluaran,
                percentage: (totalPengeluaran / totalAmount) * 100,
                color: '#E74C3C'
            });
        }

        if (totalSaving > 0) {
            chartData.push({
                label: 'Saving',
                value: totalSaving,
                percentage: (totalSaving / totalAmount) * 100,
                color: '#F39C12'
            });
        }

        // Draw donut chart with labels
        if (chartData.length > 0) {
            let currentAngle = -Math.PI / 2; // Start from top

            chartData.forEach(slice => {
                const sliceAngle = (slice.percentage / 100) * 2 * Math.PI;
                const endAngle = currentAngle + sliceAngle;
                const midAngle = currentAngle + (sliceAngle / 2); // Middle angle for label positioning

                // Draw outer arc
                const x1 = chartCenterX + Math.cos(currentAngle) * outerRadius;
                const y1 = chartCenterY + Math.sin(currentAngle) * outerRadius;
                const x2 = chartCenterX + Math.cos(endAngle) * outerRadius;
                const y2 = chartCenterY + Math.sin(endAngle) * outerRadius;

                // Draw inner arc points
                const x3 = chartCenterX + Math.cos(endAngle) * innerRadius;
                const y3 = chartCenterY + Math.sin(endAngle) * innerRadius;
                const x4 = chartCenterX + Math.cos(currentAngle) * innerRadius;
                const y4 = chartCenterY + Math.sin(currentAngle) * innerRadius;

                // Create donut slice path
                doc.save();
                doc.fillColor(slice.color);

                // Move to start of outer arc
                doc.moveTo(x1, y1);

                // Draw outer arc
                doc.arc(chartCenterX, chartCenterY, outerRadius, currentAngle, endAngle);

                // Line to start of inner arc
                doc.lineTo(x3, y3);

                // Draw inner arc (reverse direction)
                doc.arc(chartCenterX, chartCenterY, innerRadius, endAngle, currentAngle, true);

                // Close path
                doc.lineTo(x1, y1);
                doc.fill();
                doc.restore();

                // ===== ADD LABELS ON SLICES =====
                // Calculate label position
                const labelX = chartCenterX + Math.cos(midAngle) * ((outerRadius + innerRadius) / 2);
                const labelY = chartCenterY + Math.sin(midAngle) * ((outerRadius + innerRadius) / 2);

                // Only show label if slice is big enough (more than 10%)
                if (slice.percentage > 10) {
                    // Add label text (white text for better contrast)
                    doc.fontSize(7)
                        .fillColor('white')
                        .font('Helvetica-Bold')
                        .text(slice.label, labelX - 25, labelY - 8, {
                            width: 50,
                            align: 'center'
                        });

                    doc.fontSize(6)
                        .fillColor('white')
                        .font('Helvetica')
                        .text(`${slice.percentage.toFixed(0)}%`, labelX - 15, labelY + 2, {
                            width: 30,
                            align: 'center'
                        });
                }

                // ===== ADD EXTERNAL LABELS FOR SMALL SLICES =====
                if (slice.percentage <= 10) {
                    // Draw line from slice to external label
                    const lineStartX = chartCenterX + Math.cos(midAngle) * (outerRadius + 5);
                    const lineStartY = chartCenterY + Math.sin(midAngle) * (outerRadius + 5);
                    const lineEndX = chartCenterX + Math.cos(midAngle) * labelRadius;
                    const lineEndY = chartCenterY + Math.sin(midAngle) * labelRadius;

                    // Draw line
                    doc.strokeColor('#666666')
                        .lineWidth(1)
                        .moveTo(lineStartX, lineStartY)
                        .lineTo(lineEndX, lineEndY)
                        .stroke();

                    // Determine text alignment based on position
                    const textAlign = lineEndX > chartCenterX ? 'left' : 'right';
                    const textX = textAlign === 'left' ? lineEndX + 5 : lineEndX - 5;

                    // Add external label
                    doc.fontSize(8)
                        .fillColor('#2E5C8A')
                        .font('Helvetica-Bold')
                        .text(slice.label, textX - (textAlign === 'right' ? 60 : 0), lineEndY - 8, {
                            width: 60,
                            align: textAlign
                        });

                    doc.fontSize(7)
                        .fillColor('#666666')
                        .font('Helvetica')
                        .text(`${slice.percentage.toFixed(1)}%`, textX - (textAlign === 'right' ? 60 : 0), lineEndY + 2, {
                            width: 60,
                            align: textAlign
                        });
                }

                currentAngle = endAngle;
            });

            // Draw chart borders
            doc.circle(chartCenterX, chartCenterY, outerRadius).stroke('#CCCCCC');
            doc.circle(chartCenterX, chartCenterY, innerRadius).stroke('#CCCCCC');

            // Add center text
            doc.fontSize(11)
                .fillColor('#2E5C8A')
                .font('Helvetica-Bold')
                .text('OVERVIEW', chartCenterX - 30, chartCenterY - 6, {
                    width: 60,
                    align: 'center'
                });
        }

        // ===== SUMMARY SECTION (MOVED BELOW CHART) =====
        const summaryBoxX = margin;
        const summaryBoxY = chartSectionY + 250;
        const summaryBoxWidth = usableWidth;
        const summaryBoxHeight = 100;

        // Check if summary fits on current page
        if (summaryBoxY + summaryBoxHeight > pageHeight - 50) {
            doc.addPage();
            const newSummaryY = 50;

            doc.rect(summaryBoxX, newSummaryY, summaryBoxWidth, summaryBoxHeight)
                .fillAndStroke('#F8F9FA', '#E0E0E0');

            doc.fontSize(12)
                .fillColor('#2E5C8A')
                .font('Helvetica-Bold')
                .text('RINGKASAN PERIODE', summaryBoxX + 15, newSummaryY + 15);

            doc.fontSize(9)
                .fillColor('#333333')
                .font('Helvetica')
                .text(`Total Transaksi: ${transaksi.length} items`, summaryBoxX + 15, newSummaryY + 35)
                .text(`Total Pemasukan: Rp ${totalPemasukan.toLocaleString('id-ID')}`, summaryBoxX + 15, newSummaryY + 50)
                .text(`Total Pengeluaran: Rp ${totalPengeluaran.toLocaleString('id-ID')}`, summaryBoxX + 15, newSummaryY + 65)
                .text(`Saldo Bersih: Rp ${(totalPemasukan - totalPengeluaran).toLocaleString('id-ID')}`, summaryBoxX + 15, newSummaryY + 80);

            // Right column
            doc.text(`Total Saving: Rp ${totalSaving.toLocaleString('id-ID')}`, summaryBoxX + 300, newSummaryY + 50);

            if (totalAmount > 0 && totalPemasukan > 0) {
                const savingRate = (totalSaving / totalPemasukan) * 100;
                const expenseRate = (totalPengeluaran / totalPemasukan) * 100;

                doc.fontSize(8)
                    .fillColor('#666666')
                    .text(`Tingkat Saving: ${savingRate.toFixed(1)}%`, summaryBoxX + 300, newSummaryY + 65)
                    .text(`Rasio Pengeluaran: ${expenseRate.toFixed(1)}%`, summaryBoxX + 300, newSummaryY + 80);
            }
        } else {
            doc.rect(summaryBoxX, summaryBoxY, summaryBoxWidth, summaryBoxHeight)
                .fillAndStroke('#F8F9FA', '#E0E0E0');

            doc.fontSize(12)
                .fillColor('#2E5C8A')
                .font('Helvetica-Bold')
                .text('RINGKASAN PERIODE', summaryBoxX + 15, summaryBoxY + 15);

            doc.fontSize(9)
                .fillColor('#333333')
                .font('Helvetica')
                .text(`Total Transaksi: ${transaksi.length} items`, summaryBoxX + 15, summaryBoxY + 35)
                .text(`Total Pemasukan: Rp ${totalPemasukan.toLocaleString('id-ID')}`, summaryBoxX + 15, summaryBoxY + 50)
                .text(`Total Pengeluaran: Rp ${totalPengeluaran.toLocaleString('id-ID')}`, summaryBoxX + 15, summaryBoxY + 65)
                .text(`Saldo Bersih: Rp ${(totalPemasukan - totalPengeluaran).toLocaleString('id-ID')}`, summaryBoxX + 15, summaryBoxY + 80);

            // Right column
            doc.text(`Total Saving: Rp ${totalSaving.toLocaleString('id-ID')}`, summaryBoxX + 300, summaryBoxY + 50);

            if (totalAmount > 0 && totalPemasukan > 0) {
                const savingRate = (totalSaving / totalPemasukan) * 100;
                const expenseRate = (totalPengeluaran / totalPemasukan) * 100;

                doc.fontSize(8)
                    .fillColor('#666666')
                    .text(`Tingkat Saving: ${savingRate.toFixed(1)}%`, summaryBoxX + 300, summaryBoxY + 65)
                    .text(`Rasio Pengeluaran: ${expenseRate.toFixed(1)}%`, summaryBoxX + 300, summaryBoxY + 80);
            }
        }
    }

    // ===== FOOTER =====
    doc.fontSize(8)
        .fillColor('#888888')
        .font('Helvetica')
        .text(`Generated by WhatsApp Finance Bot | ${new Date().toLocaleString('id-ID')}`,
            0, pageHeight - 20, { align: 'center' });

    doc.end();

    writeStream.on('finish', async () => {
        try {
            const fileBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
            const media = new MessageMedia('application/pdf', fileBase64, path.basename(filePath));
            const chat = await message.getChat();

            await client.sendMessage(chat.id._serialized, media);

            // Hapus file setelah dikirim
            fs.unlinkSync(filePath);
            console.log(`✅ File PDF ${filePath} sudah dikirim dan dihapus.`);

            // Kirim info tambahan
            await message.reply(`📄 *PDF Rekap berhasil dikirim!*\n\n📊 Total: ${transaksi.length} transaksi\n📅 Periode: ${periode}`);

        } catch (error) {
            console.error('❌ Error kirim PDF:', error);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            await message.reply('❌ Gagal mengirim PDF. Coba lagi nanti.');
        }
    });

    writeStream.on('error', (error) => {
        console.error('❌ Error menulis PDF:', error);
        message.reply('❌ Gagal membuat PDF. Coba lagi nanti.');
    });
}

module.exports = { handleMessage };