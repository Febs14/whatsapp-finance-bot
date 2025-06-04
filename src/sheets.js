const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GOOGLE_SERVICE_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID } = require('./config');

class SheetsHandler {
    constructor() {
        this.doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
        this.isAuthenticated = false;
        this.libraryVersion = null;
    }

    async authenticate() {
        if (!process.env.GOOGLE_SERVICE_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
            throw new Error('Missing Google credentials');
        }

        let privateKey = process.env.GOOGLE_PRIVATE_KEY;
        if (!privateKey.includes('\n') && privateKey.includes('\\n')) {
            privateKey = privateKey.replace(/\\n/g, '\n');
        }

        await this.doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_EMAIL,
            private_key: privateKey,
        });

        await this.doc.loadInfo();
        this.isAuthenticated = true;
    }

    async ensureAuthenticated() {
        if (!this.isAuthenticated) {
            console.log('🔄 Connecting to Google Sheets...');
            await this.authenticate();
        }
    }

    async ensureSheetExists(sheetName, headers) {
        await this.ensureAuthenticated();

        let sheet = this.doc.sheetsByTitle[sheetName];
        if (!sheet) {
            sheet = await this.doc.addSheet({
                title: sheetName,
                headerValues: headers
            });
            console.log(`✅ Sheet ${sheetName} created`);
        } else {
            await sheet.loadHeaderRow();
            if (!sheet.headerValues || sheet.headerValues.length === 0) {
                await sheet.setHeaderRow(headers);
                console.log(`✅ Sheet ${sheetName} header fixed`);
            }
        }

        return sheet;
    }

    async addTransaction(data) {
        const headers = [
            'Tanggal', 'Jenis', 'Kategori', 'Sub Kategori',
            'Sumber Dana', 'Nominal', 'Keterangan',
            'Metode Pembayaran', 'Input Method'
        ];

        const sheet = await this.ensureSheetExists('Transaksi', headers);

        const newRow = {
            'Tanggal': new Date().toLocaleDateString('id-ID', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            }),
            'Jenis': data.type,
            'Kategori': data.category,
            'Sub Kategori': data.subcategory || 'umum',
            'Sumber Dana': data.source,
            'Nominal': data.amount,
            'Keterangan': data.detailDescription || data.description,
            'Metode Pembayaran': data.source,
        };

        await sheet.addRow(newRow);
        console.log(`✅ Transaksi added: Rp ${data.amount} - ${data.category}`);
        return true;
    }

    async getBalance(source = null) {
        const headers = ['Akun', 'Saldo'];
        const sheet = await this.ensureSheetExists('Saldo', headers);

        const rows = await sheet.getRows();
        if (rows.length === 0) {
            const defaultAccounts = [
                { 'Akun': 'CASH', 'Saldo': 0 },
                { 'Akun': 'BRI', 'Saldo': 0 },
                { 'Akun': 'BNI', 'Saldo': 0 },
                { 'Akun': 'BCA', 'Saldo': 0 },
                { 'Akun': 'MANDIRI', 'Saldo': 0 },
                { 'Akun': 'DANA', 'Saldo': 0 },
                { 'Akun': 'OVO', 'Saldo': 0 },
                { 'Akun': 'GOPAY', 'Saldo': 0 },
                { 'Akun': 'BRK', 'Saldo': 0 }
            ];
            await sheet.addRows(defaultAccounts);
            console.log('✅ Default balances initialized');

            if (source) return 0;
            const balances = {};
            defaultAccounts.forEach(acc => { balances[acc.Akun] = acc.Saldo; });
            return balances;
        }

        if (source) {
            const row = rows.find(r => r.Akun && r.Akun.toUpperCase() === source.toUpperCase());
            return row ? parseInt(row.Saldo || 0) : 0;
        } else {
            const balances = {};
            rows.forEach(r => { if (r.Akun) balances[r.Akun] = parseInt(r.Saldo || 0); });
            return balances;
        }
    }

    async updateBalance(source, amount, type, target = null) {
        await this.ensureAuthenticated();

        amount = Math.abs(amount);
        const sheet = await this.ensureSheetExists('Saldo', ['Akun', 'Saldo']);
        let rows = await sheet.getRows();

        const findRow = (akun) =>
            rows.find(r => r.Akun && r.Akun.toUpperCase() === akun.toUpperCase());

        const updateAccount = async (row, diff) => {
            let currentSaldo = parseInt(row.Saldo || 0) || 0;
            currentSaldo += diff;
            row.Saldo = currentSaldo;
            await row.save();
            return currentSaldo;
        };

        if (type === 'transfer' && target) {
            let sourceRow = findRow(source);
            let targetRow = findRow(target);

            // Buat row jika tidak ada
            if (!sourceRow) {
                await sheet.addRow({ 'Akun': source.toUpperCase(), 'Saldo': 0 });
                rows = await sheet.getRows();
                sourceRow = findRow(source);
            }
            if (!targetRow) {
                await sheet.addRow({ 'Akun': target.toUpperCase(), 'Saldo': 0 });
                rows = await sheet.getRows();
                targetRow = findRow(target);
            }

            // Source dikurang & Target ditambah
            const newSourceSaldo = await updateAccount(sourceRow, -amount);
            const newTargetSaldo = await updateAccount(targetRow, amount);

            console.log(`✅ Transfer fixed: ${source} -${amount}, ${target} +${amount}`);
            return { [source]: newSourceSaldo, [target]: newTargetSaldo };
        } else {
            let row = findRow(source);
            if (!row) {
                await sheet.addRow({ 'Akun': source.toUpperCase(), 'Saldo': 0 });
                rows = await sheet.getRows();
                row = findRow(source);
            }

            const diff = type === 'pengeluaran' ? -amount : amount;
            const newSaldo = await updateAccount(row, diff);
            console.log(`✅ Saldo updated: ${source} => Rp ${newSaldo}`);
            return { [source]: newSaldo };
        }
    }


    async testConnection() {
        try {
            this.isAuthenticated = false;
            await this.authenticate();
            const saldo = await this.getBalance('CASH');
            console.log(`🧪 Test read: CASH = Rp ${saldo}`);
            return true;
        } catch (error) {
            console.error('❌ Test failed:', error.message);
            return false;
        }
    }

    async rekapTransaksiData(periode, type) {
        await this.ensureAuthenticated();

        const sheet = await this.ensureSheetExists('Transaksi', [
            'Tanggal', 'Jenis', 'Kategori', 'Sub Kategori',
            'Sumber Dana', 'Nominal', 'Keterangan', 'Metode Pembayaran', 'Input Method'
        ]);

        const rows = await sheet.getRows();
        let transaksi = [];

        rows.forEach(row => {
            const tanggal = row.Tanggal.split(',')[0].trim();
            const [day, month, year] = tanggal.split('/');

            const rowPeriod = `${year}-${month}`;
            const rowYear = year;

            const isBulan = periode.length === 7 && rowPeriod === periode;
            const isTahun = periode.length === 4 && rowYear === periode;
            const isMatchPeriode = isBulan || isTahun;

            const jenis = row.Jenis;
            const isMatchType = !type || type.toLowerCase() === jenis.toLowerCase();

            if (isMatchPeriode && isMatchType) {
                // ✨ PERBAIKAN: Kembalikan semua kolom, tidak hanya sebagian
                transaksi.push({
                    'Tanggal': tanggal,
                    'Jenis': row.Jenis || '',
                    'Kategori': row.Kategori || '',
                    'Sub Kategori': row['Sub Kategori'] || '',
                    'Sumber Dana': row['Sumber Dana'] || '',
                    'Nominal': parseInt(row.Nominal || 0),
                    'Keterangan': row.Keterangan || ''
                });
            }
        });

        return transaksi;
    }

}

module.exports = SheetsHandler;
