require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const ejs = require("ejs");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const bcrypt = require('bcrypt');
var LocalStrategy = require('passport-local').Strategy;
var bodyParser = require('body-parser');
const http = require('http');
const fs = require('fs');
const { DateTime } = require('luxon');

const app = express();

app.set("view engine", "ejs");

//app.use//
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, }));
app.use(passport.initialize());
app.use(passport.session());

//connecting to mongoose//
const URI = process.env.ATLAS_URI;
mongoose.connect(URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const connection = mongoose.connection;
connection.once('open', function () {
  console.log("Mongoose Server up")
});

//user schema, product schema, plugin, model//
const userSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: true,
  },

  phoneNumber: {
    type: Number,
  },

  userEmail: {
    type: String,
  },

  userPassword: {
    type: String,
  },

  userCart: [{
    nameofProduct: { type: String, },
    priceofProduct: { type: Number, },
    quantityofProduct: { type: Number, },
    imgofProduct: { type: String, },
    expiryofProduct: { type: String }
  }]

});

const productSchema = new mongoose.Schema({
  productName: {
    type: String,
  },

  sellerName: {
    type: String,
  },

  productQuantity: {
    type: String,
  },

  productPrice: {
    type: String,
  },

  productExpiry: {
    type: String,
  }

});

userSchema.plugin(passportLocalMongoose, { usernameField: 'userName' });

const User = mongoose.model("User", userSchema);
const Product = mongoose.model("Product", productSchema);

//passport auth//
passport.use(new LocalStrategy({
  usernameField: 'Email',
  passwordField: 'Password',
  passReqToCallback: true
},

  async function (req, user, password, done) {                        //user = Email input frm user while log-in
    try {
      var userExists = await User.findOne({ userEmail: user });
      var hash = userExists.userPassword;
      if (userExists) {
        bcrypt.compare(password, hash, function (err, result) {
          if (result) {
            return done(null, userExists);
          }
        });
      } else {
        console.log("User doesn't exist");
      }
    } catch (error) {
      done(error);
    }
  }));

//serializing user//
passport.serializeUser(function (user, done) {
  done(null, user.id);
});

//deserializing user//
passport.deserializeUser(async function (id, done) {
  try {
    const findUser = await User.findById(id);
    if (findUser) {
      done(null, findUser);
    }
  } catch (err) {
    done(err);
  }
});

//rem_time function//
function calculateRemainingTime(expiryDate) {
  const now = new Date();
  const expiryTime = new Date(expiryDate);
  const timeDifference = expiryTime - now;

  const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000);
  const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60));
  const hours = Math.floor((timeDifference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  return { hours, minutes, seconds };
}


//get routes//
app.get("/", (req, res) => { res.render("index"); });
app.get("/index", (req, res) => { res.render("index"); });
// app.get('/shop', (req, res) => { res.render("shop1"); });
app.get('/admin', (req, res) => { res.render("admin"); });
app.get('/signup', (req, res) => { res.render("signup"); });
app.get('/login', (req, res) => { res.render("login"); });
app.get('/shop', async (req, res) => {
  try {
    const produces = await Product.find().exec();
    res.render('shop1', { produces });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching products');
    res.status(404).send('oops')
  }
});

app.get('/sse/:productId', async (req, res) => {
  console.log(req.params.productId);
  const produces = await Product.find().exec();
  const productId = req.params.productId;
  const product = produces.find((p) => p._id.toString() === productId);

  if (!product) {
    return res.status(404).end();
  }

  const expiryDate = new Date(product.productExpiry);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const intervalId = setInterval(() => {
    const remainingTime = calculateRemainingTime(expiryDate);
    if (remainingTime.hours <= 0 && remainingTime.minutes <= 0 && remainingTime.seconds <= 0) {
      clearInterval(intervalId);
      res.end();
    } else {
      res.write(`data: ${JSON.stringify(remainingTime)}\n\n`);
    }
  }, 1000);
});

//post routes//
app.post("/signup", async (req, res) => {

  const username = await req.body.Name;
  const phonenumber = await req.body.Number;
  const email = await req.body.Email;
  const hashedPassword = await bcrypt.hash(req.body.Password, 10);

  const user = new User({
    userName: username,
    phoneNumber: phonenumber,
    userEmail: email,
    userPassword: hashedPassword,
  });

  user.save();
  const result = await User.findOne({ userName: username });
  if (result) {
    res.redirect("/login");
  };
});

app.post("/product", async (req, res) => {
  const productname = await req.body.productName;
  const sellername = await req.body.sellerName;
  const quantity = await req.body.productQuantity;
  const price = await req.body.productPrice;
  const expiry = await req.body.productExpiry;

  // Specify the timezone as 'Asia/Kolkata' for IST
  const localNow = DateTime.now().setZone('Asia/Kolkata');
  const expiryHours = parseInt(req.body.productExpiry);

  if (!isNaN(expiryHours)) {
    // Calculate the expiry date based on IST time plus the specified hours
    const expiryDate = localNow.plus({ hours: expiryHours }).toJSDate();

    // Create a new Product object with the calculated expiry date
    const product = new Product({
      productName: productname,
      sellerName: sellername,
      productQuantity: quantity,
      productPrice: price,
      productExpiry: expiryDate, // Store the expiry as a Date object
    });

    product.save();
  } else {
    console.error('Invalid expiryHours:', req.body.productExpiry);
    // Handle the error or provide appropriate feedback
  }
});

app.post("/login", passport.authenticate('local'), (req, res) => {
  res.render("index");
});

app.post("/signup", async (req, res) => {

  const username = await req.body.Name;
  const phonenumber = await req.body.Number;
  const email = await req.body.Email;
  const hashedPassword = await bcrypt.hash(req.body.Password, 10);

  const user = new User({
    userName: username,
    phoneNumber: phonenumber,
    userEmail: email,
    userPassword: hashedPassword,
  });

  user.save();
  const result = await User.findOne({ userName: username });
  if (result) {
    res.redirect("/login");
  };
});

app.post("/cart", async (req, res) => {

  var productName = req.body.name;
  var productPrice = Number(req.body.price);

  const filter = { _id: req.user._id };
  var count = 0;
  await User.findOne(filter).then((db) => {
    count = db.userCart.length;
    db.userCart.push({
      imgofProduct: "images/" + productName + ".jpeg",
      nameofProduct: productName,
      priceofProduct: productPrice,
      quantityofProduct: 1,
    });
    db.save();
    res.render("cart", { cartDB: db.userCart })
  });
});

//listening port//
app.listen("3000", function () {
  console.log("Server is up and running on port 3000");
});