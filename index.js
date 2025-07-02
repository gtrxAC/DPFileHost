const express = require('express');
const fileHostRouter = require('./filehost');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, 'static')));
app.use('/', fileHostRouter);

app.listen(port, () => {
    console.log(`Server is running on port ${port}. Go to http://localhost:${port}/fh`);
});