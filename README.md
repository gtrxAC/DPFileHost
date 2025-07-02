# Dumbphone File Host
A self-hostable temporary file hosting service for transferring files to old feature phones.

Public instance available at http://gtrxac.fi/fh

## How it works
Many old feature phones lack the ability to transfer files to them from a PC or smartphone via Bluetooth, USB, memory card, etc. On such devices, often the only way to load content (e.g. apps, ringtones, graphics) to them is by downloading the content via the device's built-in web browser.

DP File Host acts as a service where users can temporarily upload a file and receive a short download link which can be used to download the uploaded file to a feature phone or similar device.

Hosting an instance of DP File Host does not require setting up any kind of database. Instead, files are stored in an upload folder, and each file name contains the required information about the file (the original file name, the download link ID, and the expiration time).

DP File Host contains some basic measures to prevent abuse - for each upload, there is a limit of 10 files totalling up to 10 MB, as well as a limit of 50 MB upload per IP address per hour. Each file expires after one hour.

## Setup
* Install Node.js.
* Open a terminal/command prompt in this project's folder.
* Run `npm i` to install the dependencies for the project.
* Optional (for generating JAD files from JARs): Install `gammu` which provides the `jadmaker` command. For example on Debian/Ubuntu: `sudo apt install gammu`.
* Change the port number in `index.js` if necessary (the default is 3000).
* Run `node .` to start the server.
  * *(or if you have an existing Express.js server and you want to hook up DP File Host to it, you can use something like `app.use("/", require("./filehost"))` in your server's code)*