const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'pITU60073803', // o la que hayas usado
    database: 'autoiq'
});

module.exports = pool.promise();
