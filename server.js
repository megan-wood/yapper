const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const canvas = require('canvas');
const sqlite3 = require('sqlite3');
const sqlite = require('sqlite'); 
const dotenv = require('dotenv');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto = require('crypto');


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Configuration and Setup
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const app = express();
const PORT = 3000;
let database;

// Load environment variables from .env file
dotenv.config();

// Use environment variables for client ID and secret
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const EMOJI_API_KEY = process.env.EMOJI_API_KEY;

// Configure passport
passport.use(new GoogleStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: `http://localhost:${PORT}/auth/google/callback`
}, (token, tokenSecret, profile, done) => {
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

/*
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    Handlebars Helpers

    Handlebars helpers are custom functions that can be used within the templates 
    to perform specific tasks. They enhance the functionality of templates and 
    help simplify data manipulation directly within the view files.

    In this project, two helpers are provided:
    
    1. toLowerCase:
       - Converts a given string to lowercase.
       - Usage example: {{toLowerCase 'SAMPLE STRING'}} -> 'sample string'

    2. ifCond:
       - Compares two values for equality and returns a block of content based on 
         the comparison result.
       - Usage example: 
            {{#ifCond value1 value2}}
                <!-- Content if value1 equals value2 -->
            {{else}}
                <!-- Content if value1 does not equal value2 -->
            {{/ifCond}}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
*/

// Set up Handlebars view engine with custom helpers
//
app.engine(
    'handlebars',
    expressHandlebars.engine({
        helpers: {
            toLowerCase: function (str) {
                return str.toLowerCase();
            },
            ifCond: function (v1, v2, options) {
                if (v1 === v2) {
                    return options.fn(this);
                }
                return options.inverse(this);
            },
            filterUserPosts: function (posts, user) {
                userPosts = [];
                for (let i = 0; i < posts.length; ++i) {
                    if (posts.at(i).username == user.username) {  // one of the user's posts
                        userPosts.push(posts.at(i));
                    }
                }
                user["posts"] = userPosts; 
                return;
            },
            getUserAvatar: function (username) {
                let avatarURL = undefined;  
                const user = findUserByUsernameFromInMemArray(username); 
                if (user.avatar_url == "") {
                    avatarURL = createAvatarImageToFile(username);
                    return avatarURL;
                }
                avatarURL = user.avatar_url;
                return user.avatar_url;
            },
            resolveAvatarURL: function (avatarURL) {
                console.log("avatarURL: ", avatarURL);
            }
        },
    })
);

app.set('view engine', 'handlebars');
app.set('views', './views');

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Middleware
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.use(
    session({
        secret: 'oneringtorulethemall',     // Secret key to sign the session ID cookie
        resave: false,                      // Don't save session if unmodified
        saveUninitialized: false,           // Don't create session until something stored
        cookie: { secure: false },          // True if using https. Set to false for development without https
    })
);

// Replace any of these variables below with constants for your application. These variables
// should be used in your template files. 
// 
app.use((req, res, next) => {
    res.locals.appName = 'Yapper';
    res.locals.copyrightYear = 2024;
    res.locals.postNeoType = 'Post';
    res.locals.loggedIn = req.session.loggedIn || false;
    res.locals.userId = req.session.userId || '';
    next();
});

app.use(express.static('public'));                  // Serve static files
app.use(express.urlencoded({ extended: true }));    // Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.json());                            // Parse JSON bodies (as sent by API clients)

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Routes
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Home route: render home view with posts and user
// We pass the posts and user variables into the home
// template
//
app.get('/', async (req, res) => {
    const option = req.query.option;
    // const user = undefined; 
    let posts = [];
    if (option) {
        posts = await getPosts(option);
        // user = await getCurrentUser(req) || {};
        // res.render('home', { posts, user, EMOJI_API_KEY });
    } else {
        posts = await getPosts("date");
        // user = await getCurrentUser(req) || {};
        // res.render('home', { posts, user, EMOJI_API_KEY });
    }
    posts = removeLeadingSpaces(posts);
    const user = await getCurrentUser(req) || {};
    const replies = await getReplies();
    res.render('home', { posts, user, replies, EMOJI_API_KEY });
});

// Load the home page with the specific sorted order
// app.get('/posts', async (req, res) => {
//     const option = req.query.option;
//     const posts = await getPosts(option);
//     const replies = await getReplies();
//     const user = await getCurrentUser(req)|| {};
//     res.render('home', { posts, user, replies, EMOJI_API_KEY });
// });

// Register GET route is used for error response from registration
//
app.get('/register', (req, res) => {
    res.render('loginRegister', { regError: req.query.error });
});

// Login route GET route is used for error response from login
//
app.get('/login', (req, res) => {
    res.render('loginRegister', { loginError: req.query.error });
});

// Error route: render error page
//
app.get('/error', (req, res) => {
    res.render('error');
});

// Additional routes that you must implement

app.post('/posts', isAuthenticated, (req, res) => {
// Add a new post and redirect to home
    const title = req.body.postTitle;
    const content = req.body.usersPostContent;
    const user = req.session.userId;
    addPost(title, content, user); 
    res.redirect('/');
});
app.post('/edit/:postId', isAuthenticated, async (req, res) => {
    // edit an existing post and rediret to home
    const content = req.body.editContent;
    const postId = req.params.postId;
    await editPost(content, postId, req);
    res.redirect('/');
})
app.post('/like/:id', isAuthenticated, async function(req, res) {
    // Update post likes
    await updatePostLikes(req, res);
    // res.redirect('/');
});
app.post('/likeReply/:replyId', isAuthenticated, async function(req, res) {
    // Update reply likes
    await updateReplyLikes(req, res); 
});
app.get('/profile', isAuthenticated, (req, res) => {
    // Render profile page
    renderProfile(req, res);
});
app.get('/avatar/:username', (req, res) => {
    // Serve the avatar image for the user
    handleAvatar(req, res);
});

app.post('/register', (req, res) => {
    // Register a new user
    registerUser(req, res);
});

app.post('/login', (req, res) => {
    // Login/authenticate a user and start a session
    console.log("login route");
    loginUser(req, res);
});
app.get('/logout', isAuthenticated, (req, res) => {
    // Logout the user
        logoutUser(req, res);
});
app.post('/delete/:id', isAuthenticated, (req, res) => {
    // Delete a post if the current user is the owner
    deletePost(req, res);
});
app.post('/deleteReply/:replyId/', isAuthenticated, (req, res) => {
    deleteReply(req, res);
});
// app.post('/sort/:option', async (req, res) => {
//     // Sort posts based on the option
//     const option = req.params.option;
//     renderSortedPosts(req, res); 
// });

// OAuth integration
app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }), (req, res) => {
    // Google login
    const url = client.generateAuthUrl({
        access_type: 'offline',
    });
    res.redirect(url);
});
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), async (req, res) => {
    // Google callback
    const googleId = req.user.id;
    const hash = crypto.createHash('sha256');
    hash.update(googleId);
    const hashedGoogleId = hash.digest('hex');
    req.session.hashedGoogleId = hashedGoogleId;
    // Check if user already exists
    try {
        let localUser = await findUserByHashedGoogleId(hashedGoogleId);
        if (localUser) {
            req.session.userId = localUser.id;
            req.session.loggedIn = true;
            res.redirect('/'); // user exists, redirect home
        } else {
            console.log("redirecting to registerUsername right now...")
            res.redirect('/registerUsername'); // user doesn't exist, redirect registerUser
        }
    }
    catch(err){
    console.error('Error finding user:', err);
    res.redirect('/error');
    }
});
app.get('/registerUsername', (req, res) => {
    // Username registration page
    res.render('registerUsername', { regError: req.query.error });

});
app.post('/registerUsername', (req, res) => {
    // checks if username is available
    registerUser(req, res);
});
app.get('/logout', (req, res) => {
    // logout of session
    req.session.userId = "";
    req.session.loggedIn = false;
    logoutUser(req, res);
});
app.get('/googleLogout', (req, res) => {
    // render logout page
    res.render('googleLogout', { regError: req.query.error });
});
app.get('/logoutCallback', (req, res) => {
    res.redirect('/');
});

app.post('/replyPost/:postId', isAuthenticated, (req, res) => {
    console.log("trying to reply");
    console.log("information recevied is postId: ", req.params.postId,
        "req.body: ", req.body.replyContent);
    const postId = req.params.postId;
    const replyContent = req.body.replyContent;
    const user = req.session.userId;
    addPostReply(postId, replyContent, user);
    res.redirect('/');
});


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Server Activation
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.listen(PORT, async () => {
    database = await connectToDatabase(); 
    await transferUsersFromTable();
    console.log(`Server is running on http://localhost:${PORT}`);
});

async function connectToDatabase() {
    try {
        const database = await sqlite.open( {
            filename: 'microBlog.db', 
            driver: sqlite3.Database
        });
        return database;
    } catch (error) {
        console.log("Eror connecting to database: ", error); 
    }
}

async function transferUsersFromTable() {
    const query = 'SELECT * from USERS';
    usersFromTable = await database.all(query);
    return;
}

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Support Functions and Variables
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Example data for posts and users
// let posts = [
//     { id: 1, title: 'Sample Post', content: 'This is a sample post.', username: 'SampleUser', timestamp: '2024-01-01 10:00', likes: 0 },
//     { id: 2, title: 'Another Post', content: 'This is another sample post.', username: 'AnotherUser', timestamp: '2024-01-02 12:00', likes: 0 },
// ];
// let users = [
//     { id: 1, username: 'SampleUser', avatar_url: undefined, memberSince: '2024-01-01 08:00' },
//     { id: 2, username: 'AnotherUser', avatar_url: undefined, memberSince: '2024-01-02 09:00' },
// ];
let usersFromTable = []; 

// Function to find a user by username
async function findUserByUsername(username) {
    // Return user object if found, otherwise return undefined
    try {
        const query = `SELECT * FROM users WHERE username=?`;
        const userArray = await database.all(query, username);
        const user = userArray[0];
        console.log("username user: ", userArray[0]);
        return userArray[0];
        // return user;
    } catch (error) {
        console.log("Error finding the user by username or not found: ", error);
        return undefined;  // user was not found in the database
    }
}

function findUserByUsernameFromInMemArray(username) {
    for (let i = 0; i < usersFromTable.length; ++i) {
        if (username == usersFromTable.at(i).username) {
            return usersFromTable.at(i);
        }
    }
    return undefined; 
}

// Function to find a user by user ID
async function findUserById(userId) {
    // Return user object if found, otherwise return undefined
    try {
        const query = `SELECT * FROM users WHERE id=?`;
        let user = await database.all(query, userId);
        user = user[0];
        console.log("id user: ", user);
        return user;
    } catch (error) {
        console.log("Error finding the user by id or not found: ", error);
        return undefined;  // user was not found in the database
    }
}

async function findUserByHashedGoogleId(hashedGoogleId) {
    try {
        const query = `SELECT * FROM users WHERE hashedGoogleId=?`;
        let user = await database.all(query, hashedGoogleId);
        user = user[0];
        console.log("id user: ", user);
        return user;
    } catch (error) {
        console.log("Error finding the user by hashed google id or not found: ", error);
        return undefined;  // user was not found in the database
    }
}

// Function to find a post by post ID
async function findPostById(postId) {
    // Return post object if found, otherwise return undefined
    try {
        const query = `SELECT * FROM posts WHERE id=?`;
        let post = await database.all(query, postId);
        post = post[0];
        console.log("user: ", post);
        return post;
    } catch (error) {
        console.log("Error finding the post or not found: ", error);
        return undefined;  // post was not found in the database
    }
}

// Function to find the reply by reply ID
async function findReplyById(replyId) {
    // Return reply object if found, otherwise return undefined
    try {
        const query = `SELECT * FROM replies WHERE replyId=?`;
        let reply = await database.all(query, replyId);
        reply = reply[0];
        return reply;
    } catch (error) {
        console.log("Error finding the reply or not found: ", error);
        return undefined;  // replyF was not found in the database
    }
}

// Function to add a new user
function addUser(username, hashedGoogleId) {
    // Create a new user object and add to users array
    // Format: { id: 1, username: 'SampleUser', avatar_url: undefined, memberSince: '2024-01-01 08:00' },
    const curTime = getCurTime();
    console.log("cur time: ", curTime);
    const avatarUrl = createAvatarImageToFile(username);  // create avatar image upon adding a user
    const user = {id: usersFromTable.length + 1, username: username, hashedGoogleId: hashedGoogleId, avatar_url: avatarUrl, memberSince: curTime};
    usersFromTable.push(user);
    const query = 'INSERT INTO users (username, hashedGoogleId, avatar_url, memberSince) VALUES (?, ?, ?, ?)';
    database.run(query, [username, hashedGoogleId, avatarUrl, curTime]);
}

// Function added to get the current time and outputs a formatting string of it
function getCurTime() {
    const time = new Date();
    const year = time.getFullYear();
    const month = (time.getMonth() + 1).toString().padStart(2, '0');
    const day = time.getDate().toString().padStart(2, '0'); 
    const hour = time.getHours().toString().padStart(2, '0');
    const minute = time.getMinutes().toString().padStart(2, '0'); 
    return `${year}-${month}-${day} ${hour}:${minute}`;
}

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    console.log("Check authentication of userid ", req.session.userId);
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Function to register a user
async function registerUser(req, res) {
    // Register a new user and redirect appropriately
    const username = req.body.regUsername;
    const hashedGoogleId = req.session.hashedGoogleId;
    console.log("Attemping to register user: ", username);
    let registeredUser = await findUserByUsername(username);
        if (registeredUser) {
            // Username already exists
            res.redirect('/registerUsername?error=Username+already+exists');
        } else {  // user did not exist yet
            // Add the new user
            addUser(username, hashedGoogleId);
            registeredUser = await findUserByUsername(username);
            req.session.userId = registeredUser.id;
            req.session.loggedIn = true; 
            res.redirect('/');
        }
}

// Function to login a user
async function loginUser(req, res) {
    // Login a user and redirect appropriately
    const username = req.body.loginUsername;
    console.log("looking for user: ", username);
    const user = await Promise.resolve(findUserByUsername(username));
    if (user == undefined) {
        // Username was not found
        res.redirect('login?error=Username+was+not+found');
    } else if (user.username == username) {
        // Username found so go back to main page
        if (user.avatar_url == undefined) { // Make sure an avatar has been generated before redirecting to home page
            user.avatar_url = createAvatarImageToFile(username); 
        }
        req.session.userId = user.id;
        req.session.loggedIn = true; 
        res.redirect('/');
    }
}

// Function to logout a user
function logoutUser(req, res) {
    // Destroy session and redirect appropriately
    req.session.userId = "";
    req.session.loggedIn = false;
    res.redirect('/googleLogout');
}

// Function to render the profile page
async function renderProfile(req, res) {
    // Fetch user posts and render the profile page
    const posts = await getPostsDefault(req);
    const user = await getCurrentUser(req);
    const replies = await getReplies(req);
    res.render('profile', { posts, user, replies});
}

// Function to update post likes
async function updatePostLikes(req, res) {
    // Increment post likes if conditions are met
    const postId = req.params.id;
    const currPost = await findPostById(postId);
    const currUser = await getCurrentUser(req);

    if (currPost.username != currUser.username) {
        currPost.likes++;
        const query = `UPDATE posts SET likes = likes + 1 WHERE id = ${postId}`
        await database.run(query);
    }
}

// Function to update reply likes
async function updateReplyLikes(req, res) {
    // Increment reply likes if conditions are met 
    const replyId = req.params.replyId;
    const currReply = await findReplyById(replyId);
    const currUser = await getCurrentUser(req);

    if (currReply.username != currUser.username) {
        currReply.likes++;
        const query = `UPDATE replies SET likes = likes + 1 WHERE replyId = ${replyId}`
        await database.exec(query);
    }
}

// Added: Function to delete 
async function deletePost(req, res) {
    // Delete post
    const postId = req.params.id;
    const currPost = await findPostById(postId); 
    const currUser = await getCurrentUser(req); 
    console.log("postId", postId);

    if (currPost.username === currUser.username) {
        const query = 'DELETE FROM posts WHERE id=?';
        try {
            await database.run(query, postId); 
        } catch (error) {
            console.log("error deleting post:", error);
        }
    }
    res.redirect('/');
}

// Added: function to delete reply
async function deleteReply(req, res) {
    // Delete reply
    const replyId = req.params.replyId;
    const currReply = await findReplyById(replyId);
    const currUser = await getCurrentUser(req);
    
    if (currReply.username == currUser.username) {
        const query = 'DELETE FROM replies WHERE replyId=?';
        try {
            database.run(query, replyId);
        } catch (error) {
            console.log("error deleting reply: ", error);
        }
    }
    res.redirect('/');
}

function getIndexOfPost(postId) {
    for (let i = 0; i < posts.length; ++i) {
        if (posts.at(i).id == postId) {
            return i;
        }
    }
}

// Function to handle avatar generation and serving
function handleAvatar(req, res) {
    // Generate and serve the user's avatar image
    const name = req.params.username;
    const user = findUserByUsername(name);

    if (user == undefined) {
        res.status(404).send('User not found');
    }
    if (user.avatar_url == undefined) {
        user.avatar_url = createAvatarImageToFile(name); 
    }
    console.log("avatar url: ", user.avatar_url);
    res.send(user.avatar_url);
}

function createAvatarImageToFile(username) {
    const letter = username.charAt(0).toUpperCase();
    const buffer = generateAvatar(letter);

    const fs = require("fs");
    try {
        if (!fs.existsSync("./public/images/avatar")) {
          fs.mkdirSync("./public/images/avatar");
        }
    } catch (err) {
        console.error(err);
    }

    console.log(`./public/images/avatar/${username}`);
    try {
        if(!fs.existsSync(`./public/images/avatar/${username}.png`)) {
            const filename = `./public/images/avatar/${username}.png`;
            fs.writeFileSync(filename, buffer);
            console.log("File written successfully\n");
        } else {
            console.log("file already exists");
        }
        return `images/avatar/${username}.png`;
    } catch (error) {
        console.log(error);
        res.status(500).send('File was not created.');
    }
}

// Function to get the current user from session
async function getCurrentUser(req) {
    // Return the user object if the session user ID matches
    let user = await findUserById(req.session.userId);
    return user;
}

// Function to get all posts, sorted by latest first
async function getPosts(option) {
    let query = ''; 
    if (option == 'likes') {
        query = 'SELECT * FROM posts ORDER BY likes DESC';
    } else {
        query = 'SELECT * FROM posts ORDER BY timestamp DESC'
    }
    const postListArray = await database.all(query);
    return postListArray;
}

async function getPostsDefault(req) {
    let option = req.params.option;
   
    let query = ''; 
    if (option == 'likes') {
        query = 'SELECT * FROM posts ORDER BY likes DESC';
    } else {
        query = 'SELECT * FROM posts ORDER BY timestamp DESC'
    }
    const postListArray = await database.all(query);
    return postListArray;
}

async function getReplies() {
    query = 'SELECT * FROM replies ORDER BY replyId, timestamp DESC';
    const repliesListArray = await database.all(query);
    return repliesListArray;
}

// Function to add a new post
async function addPost(title, content, user) {
    // Create a new post object and add to posts array
    // Format: { id: 1, title: 'Sample Post', content: 'Content', username: 'SampleUser', timestamp: '2024-01-01 10:00', likes: 0 },

    const curTime = getCurTime();
    const userObj= await findUserById(user);
    const username = userObj.username; 
    const likes = 0, edited = 0; 
    // const post = {id: posts.length + 1, title: title, content: content, username: username, timestamp: curTime, likes: 0};
    // posts.push(post);
    const query = 'INSERT INTO posts (title, content, username, timestamp, likes, edited) VALUES (?, ?, ?, ?, ?, ?)';
    database.run(query, [title, content, username, curTime, likes, edited]);
}

async function editPost(content, postId, req) {
    const curTime = getCurTime();
    const currUser = await getCurrentUser(req); 
    const post = await findPostById(postId);
    const edited = 1;  // 1 indicates that the post has been edited so it should be displayed
    if (currUser.username == post.username) {
        const query = `UPDATE posts SET content=?, timestamp=?, edited=? WHERE id=?`
        await database.run(query, [content, curTime, edited, postId]);
    }
}

async function addPostReply(originalPostId, content, user) {
    const curTime = getCurTime();
    const userObj = await findUserById(user);
    const username = userObj.username; 
    const likes = 0;
    const query = 'INSERT INTO replies (originalPostId, content, username, timestamp, likes) VALUES (?, ?, ?, ?, ?)';
    database.run(query, [originalPostId, content, username, curTime, likes]);
    } 

// added: generate random color
function generateRandColor() {
    const r = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);

    const colors = ["rgb(125, 52, 92)", "rgb(255, 230, 181)", "rgb(223, 252, 222)", "rgb(157, 177, 209)", "rgb(55, 125, 52)", 
                    "rgb(209, 157, 186)", "rgb(209, 192, 157)", "rgb(37, 61, 36)", "rgb(52, 80, 125)", "rgb(186, 168, 76)"];
    const rand_color = Math.floor(Math.random() * 10);

    return colors[rand_color];
}

// Function to generate an image avatar
function generateAvatar(letter, width = 200, height = 200) {
    // Generate an avatar image with a letter
    // Steps:
    // 1. Choose a color scheme based on the letter
    // 2. Create a canvas with the specified width and height
    // 3. Draw the background color
    // 4. Draw the letter in the center
    // 5. Return the avatar as a PNG buffer

    const { createCanvas } = require("canvas");

    const backgroundColor = generateRandColor();

    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, width, height);

    context.font = "bold 90pt 'Trebuchet MS'";
    context.textAlign = "center";
    context.textBaseline = "middle";

    const rgbValues = backgroundColor.substring(4,  backgroundColor.length - 1).split(',');
    const red = rgbValues[0], green = rgbValues[1], blue = rgbValues[2];

    if ((red * 0.2126 + green * 0.7152 + blue * 0.0722) < 128) {
        // if the brightness is too dark -> letter is white
        context.fillStyle = '#fff';
        console.log("text is white");
    } else {
        // if the brightness is too light -> letter is black
        context.fillStyle = '#000';
        console.log("text is black");

    }
    context.fillText(letter, width / 2, height / 2);

    const buffer = canvas.toBuffer('image/png');
    return buffer;
}

function removeLeadingSpaces(posts) {
    const whitespaceRemoved = [];
    for (let i = 0; i < posts.length; ++i) {
        let text = posts.at(i).content;
        text = removeLeadingSpacesFromWord(text);
        console.log(text);
        posts.at(i).content = text;
    }
    return posts; 
}

function removeLeadingSpacesFromWord(str) {
    let newStr = "";
    for (let i = 0; i < str.length; ++i) {
        if (str.at(i) != `\r`) {
            newStr = newStr + str.at(i);
        }
    }
    return newStr;
}

// async function renderSortedPosts(req, res) {
//     // const option = req.params.option;
//     // const option = req.query.option; 
//     const posts = await getPostsDefault(req);
//     const user = await getCurrentUser(req)|| {};
//     res.render('home', { posts, user, EMOJI_API_KEY });
// }