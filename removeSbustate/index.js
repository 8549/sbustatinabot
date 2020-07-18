'use strict';

const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore();

exports.start = (req, res) => {
  if (req.method === 'POST') {
    db.collectionGroup('sbustate').get()
    .then(querySnapshot => {
      querySnapshot.forEach((doc) => doc.ref.delete())
    })
    .then(() => res.sendStatus(200))
    .catch(err => console.error(err));
  }
  else {
    console.error('Method not supported.')
    res.sendStatus(405);
  }
}